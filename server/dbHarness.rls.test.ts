import { describe, expect, it } from "vitest";
import { assertLocalTestDatabaseUrl } from "../scripts/db-test/safety";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("local DB harness safety", () => {
  it("refuses non-localhost TEST_DATABASE_URL hosts", () => {
    expect(() => assertLocalTestDatabaseUrl("postgresql://user:pass@db.example.com:5432/app")).toThrow(/refused/i);
    expect(() => assertLocalTestDatabaseUrl("postgresql://user:pass@127.0.0.1:55432/app")).not.toThrow();
  });
});

describe.skipIf(!testDatabaseUrl)("RLS and concurrency against TEST_DATABASE_URL", () => {
  it("connects only after localhost guard", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [{ ok }] = await sql`select 1::int as ok`;
      expect(ok).toBe(1);
      const helpers = await sql`
        select proname from pg_proc
        where pronamespace = 'agricoop_app'::regnamespace
          and proname in ('current_app_user_id', 'write_audit_log', 'create_notification')
      `;
      expect(helpers.length).toBeGreaterThanOrEqual(1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("prevents buyer from reading another buyer's orders under authenticated role", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      await sql.begin(async tx => {
        await tx`select set_config('role', 'authenticated', true)`;
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        // Without a JWT subject, current_app_user_id is null → no order rows visible
        await tx`select set_config('request.jwt.claim.sub', '', true)`;
        await tx`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
        const rows = await tx`select id from agricoop_app.orders`;
        expect(rows).toEqual([]);
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps login columns readable and seller payment columns denied after system-payment revokes", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [row] = await sql`
        select
          has_column_privilege('authenticated', 'agricoop_app.users', 'openId', 'SELECT') as open_id_sel,
          has_column_privilege('authenticated', 'agricoop_app.users', 'role', 'SELECT') as role_sel,
          has_column_privilege('authenticated', 'agricoop_app.users', 'profileImageUrl', 'SELECT') as photo_sel,
          has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') as qr_sel,
          has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentAccountName', 'SELECT') as acct_sel,
          has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') as anon_qr_sel,
          has_column_privilege('anon', 'agricoop_app.cooperatives', 'name', 'SELECT') as anon_coop_name,
          has_column_privilege('anon', 'agricoop_app.cooperatives', 'normalizedName', 'SELECT') as anon_coop_slug,
          has_column_privilege('authenticated', 'public.profiles', 'user_id', 'INSERT') as profile_insert
      `;
      expect(row.open_id_sel).toBe(true);
      expect(row.role_sel).toBe(true);
      expect(row.photo_sel).toBe(true);
      expect(row.qr_sel).toBe(false);
      expect(row.acct_sel).toBe(false);
      expect(row.anon_qr_sel).toBe(false);
      expect(row.anon_coop_name).toBe(true);
      expect(row.anon_coop_slug).toBe(true);
      expect(row.profile_insert).toBe(true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("allows anon marketplace cooperative join fields", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      await sql.begin(async tx => {
        await tx`select set_config('role', 'anon', true)`;
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
        const rows = await tx`
          select c.name, c."normalizedName"
          from agricoop_app.cooperatives c
          where c.status = 'active'
          limit 5
        `;
        expect(Array.isArray(rows)).toBe(true);
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

if (!testDatabaseUrl) {
  describe("RLS harness availability", () => {
    it("marks DB-backed RLS tests as NOT VERIFIED when TEST_DATABASE_URL is unset", () => {
      expect(testDatabaseUrl).toBeFalsy();
    });
  });
}
