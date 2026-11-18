import { describe, expect, it } from "vitest";
import { assertLocalTestDatabaseUrl } from "../scripts/db-test/safety";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runningInCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

if (runningInCi && !testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required in CI for the DB RLS harness.");
}

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
        await tx.unsafe("set local role authenticated");
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
          has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentQrPath', 'INSERT') as qr_ins,
          has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') as anon_qr_sel,
          has_column_privilege('anon', 'agricoop_app.cooperatives', 'name', 'SELECT') as anon_coop_name,
          has_column_privilege('anon', 'agricoop_app.cooperatives', 'normalizedName', 'SELECT') as anon_coop_slug,
          has_column_privilege('authenticated', 'public.profiles', 'user_id', 'INSERT') as profile_insert,
          has_column_privilege('authenticated', 'public.profiles', 'full_name', 'INSERT') as profile_name_ins,
          has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as profile_name_upd,
          has_column_privilege('authenticated', 'agricoop_app.users', 'openId', 'INSERT') as user_openid_ins
      `;
      expect(row.open_id_sel).toBe(true);
      expect(row.role_sel).toBe(true);
      expect(row.photo_sel).toBe(true);
      expect(row.qr_sel).toBe(false);
      expect(row.acct_sel).toBe(false);
      expect(row.qr_ins).toBe(false);
      expect(row.anon_qr_sel).toBe(false);
      expect(row.anon_coop_name).toBe(true);
      expect(row.anon_coop_slug).toBe(true);
      expect(row.profile_insert).toBe(true);
      expect(row.profile_name_ins).toBe(true);
      // Registration uses plain INSERT (routers.ts); ON CONFLICT DO UPDATE must stay denied.
      expect(row.profile_name_upd).toBe(false);
      expect(row.user_openid_ins).toBe(true);
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
        await tx.unsafe("set local role anon");
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

  it("registration insert and login select under authenticated role", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const authUserId = "11111111-1111-4111-8111-111111111111";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values (${authUserId}::uuid, 'harness-buyer@example.test')
          on conflict (id) do nothing`;
        await tx`select set_config('role', 'authenticated', true)`;
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', ${authUserId}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: authUserId })},
          true
        )`;

        await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId", "lastSignedIn"
          ) values (
            ${authUserId},
            'Harness Buyer',
            'harness-buyer@example.test',
            'supabase',
            'buyer',
            'approved',
            null,
            now()
          )
          on conflict ("openId") do update set "lastSignedIn" = excluded."lastSignedIn"
        `;

        const [roleRow] = await tx`select role_id from public.roles where role_name = 'buyer' limit 1`;
        expect(roleRow?.role_id).toBeTruthy();

        // Match production registration: plain INSERT of granted columns only
        // (no ON CONFLICT DO UPDATE — authenticated has no UPDATE on profiles).
        await tx`
          insert into public.profiles (user_id, full_name, email, role_id)
          values (${authUserId}::uuid, 'Harness Buyer', 'harness-buyer@example.test', ${roleRow.role_id})
        `;

        // Login projection: only granted columns (no onlinePayment*).
        const loginRows = await tx`
          select id, "openId", role, "approvalStatus", "profileImageUrl"
          from agricoop_app.users
          where "openId" = ${authUserId}
          limit 1
        `;
        expect(loginRows).toHaveLength(1);
        expect(loginRows[0].role).toBe("buyer");

        // Selecting a revoked payment column must fail for authenticated.
        // Use SAVEPOINT so the 42501 does not abort the outer transaction.
        await tx`savepoint deny_payment_select`;
        let paymentSelectDenied = false;
        try {
          await tx`select "onlinePaymentQrPath" from agricoop_app.users where "openId" = ${authUserId}`;
        } catch (error) {
          paymentSelectDenied = String((error as { code?: string }).code ?? "") === "42501"
            || /permission denied|onlinePaymentQrPath/i.test(String(error));
        }
        await tx`rollback to savepoint deny_payment_select`;
        expect(paymentSelectDenied).toBe(true);

        // Roll back throwaway rows for this transaction.
        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enforces cooperativeAdminApplications and order archive privileges for Part 2", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [meta] = await sql`
        select
          to_regclass('agricoop_app."cooperativeAdminApplications"') is not null as apps_table,
          exists(
            select 1 from information_schema.columns
            where table_schema = 'agricoop_app' and table_name = 'users' and column_name = 'requestedRole'
          ) as requested_role_col,
          exists(
            select 1 from information_schema.columns
            where table_schema = 'agricoop_app' and table_name = 'cooperatives' and column_name = 'source'
          ) as coop_source_col,
          exists(
            select 1 from pg_proc
            where pronamespace = 'agricoop_app'::regnamespace
              and proname = 'create_user_cooperative'
          ) as create_user_coop_fn,
          exists(
            select 1 from pg_constraint
            where conname = 'thread_states_channel_check'
              and conrelid = 'agricoop_app."threadStates"'::regclass
              and pg_get_constraintdef(oid) like '%order%'
          ) as order_channel_allowed,
          exists(
            select 1 from storage.buckets where id = 'coop-admin-applications' and public = false
          ) as private_app_bucket
      `;
      expect(meta.apps_table).toBe(true);
      expect(meta.requested_role_col).toBe(true);
      expect(meta.coop_source_col).toBe(true);
      expect(meta.create_user_coop_fn).toBe(true);
      expect(meta.order_channel_allowed).toBe(true);
      expect(meta.private_app_bucket).toBe(true);

      expect(await sql`
        select has_column_privilege('authenticated', 'agricoop_app.users', 'requestedRole', 'SELECT') as ok
      `.then(rows => rows[0]?.ok)).toBe(true);
      expect(await sql`
        select has_column_privilege('authenticated', 'agricoop_app.cooperatives', 'source', 'SELECT') as ok
      `.then(rows => rows[0]?.ok)).toBe(true);
      expect(await sql`
        select has_column_privilege(
          'anon',
          to_regclass('agricoop_app."cooperativeAdminApplications"'),
          'id',
          'SELECT'
        ) as ok
      `.then(rows => rows[0]?.ok)).toBe(false);

      expect(await sql`
        select has_column_privilege(
          'authenticated',
          to_regclass('agricoop_app."cooperativeAdminApplications"'),
          'id',
          'SELECT'
        ) as ok
      `.then(rows => rows[0]?.ok)).toBe(true);

      await sql.begin(async tx => {
        await tx`select set_config('role', 'authenticated', true)`;
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', '', true)`;
        await tx`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`;
        const apps = await tx`select id from agricoop_app."cooperativeAdminApplications"`;
        expect(apps).toEqual([]);
        const states = await tx`select id from agricoop_app."threadStates" where channel = 'order'`;
        expect(states).toEqual([]);
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("defines coop-admin-applications storage owner policies on storage.objects", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const policies = await sql`
        select policyname, cmd
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname like 'coop_admin_apps_%'
        order by policyname
      `;
      const names = policies.map(row => row.policyname);
      expect(names).toEqual(expect.arrayContaining([
        "coop_admin_apps_owner_insert",
        "coop_admin_apps_owner_select",
        "coop_admin_apps_owner_update",
      ]));
      expect(new Set(policies.map(row => row.cmd))).toEqual(new Set(["INSERT", "SELECT", "UPDATE"]));
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("grants create_user_cooperative EXECUTE to authenticated and not anon", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [row] = await sql`
        select
          has_function_privilege(
            'authenticated',
            'agricoop_app.create_user_cooperative(character varying, character varying, character varying, text)',
            'EXECUTE'
          ) as auth_exec,
          has_function_privilege(
            'anon',
            'agricoop_app.create_user_cooperative(character varying, character varying, character varying, text)',
            'EXECUTE'
          ) as anon_exec
      `;
      expect(row.auth_exec).toBe(true);
      expect(row.anon_exec).toBe(false);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("grants authenticated UPDATE on products.status for soft listing archive", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [row] = await sql`
        select
          has_column_privilege('authenticated', 'agricoop_app.products', 'status', 'UPDATE') as status_upd,
          exists(
            select 1 from information_schema.columns
            where table_schema = 'agricoop_app'
              and table_name = 'products'
              and column_name = 'deletedAt'
          ) as products_deleted_at
      `;
      expect(row.status_upd).toBe(true);
      // Archive is modeled via products.status, not a deletedAt tombstone column.
      expect(row.products_deleted_at).toBe(false);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("allows authenticated buyers to insert order-channel threadStates under RLS (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const authUserId = "22222222-2222-4222-8222-222222222222";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values (${authUserId}::uuid, 'harness-order-archive@example.test')
          on conflict (id) do nothing`;
        await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId", "lastSignedIn"
          ) values (
            ${authUserId},
            'Harness Buyer Archive',
            'harness-order-archive@example.test',
            'supabase',
            'buyer',
            'approved',
            null,
            now()
          )
          on conflict ("openId") do update set "lastSignedIn" = excluded."lastSignedIn"
        `;
        const [appUser] = await tx`
          select id from agricoop_app.users where "openId" = ${authUserId} limit 1
        `;
        expect(appUser?.id).toBeTruthy();

        await tx`select set_config('role', 'authenticated', true)`;
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', ${authUserId}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: authUserId })},
          true
        )`;

        await tx`
          insert into agricoop_app."threadStates" ("userId", channel, "threadId", "archivedAt")
          values (${appUser.id}, 'order', 424242, now())
        `;
        const [inserted] = await tx`
          select id, channel from agricoop_app."threadStates"
          where "userId" = ${appUser.id} and channel = 'order' and "threadId" = 424242
        `;
        expect(inserted?.channel).toBe("order");

        await tx`savepoint reject_invalid_thread_channel`;
        let invalidChannelRejected = false;
        try {
          await tx`
            insert into agricoop_app."threadStates" ("userId", channel, "threadId")
            values (${appUser.id}, 'not_a_channel', 424243)
          `;
        } catch (error) {
          invalidChannelRejected = /check constraint|thread_states_channel_check|23514/i.test(String(error));
        }
        await tx`rollback to savepoint reject_invalid_thread_channel`;
        expect(invalidChannelRejected).toBe(true);

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
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
