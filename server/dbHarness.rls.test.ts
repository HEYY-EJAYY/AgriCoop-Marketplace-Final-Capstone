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

  it("allows anonymous marketplace seller reads without exposing soft-deleted sellers", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const activeSellerAuth = "e1000000-0000-4000-8000-000000000001";
    const deletedSellerAuth = "e1000000-0000-4000-8000-000000000002";
    const superAdminAuth = "e1000000-0000-4000-8000-000000000003";
    try {
      await sql.begin(async tx => {
        const [cooperative] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Public Seller Cooperative', 'harnesspublicsellercooperative',
            'Test City', 'Barangay 8', 'testcity8', 'active', 'seed'
          )
          returning id
        `;
        const createUser = async (
          openId: string,
          name: string,
          email: string,
          role: "seller" | "superadmin",
          cooperativeId: number | null,
        ) => {
          const [user] = await tx`
            insert into agricoop_app.users (
              "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
            ) values (
              ${openId}, ${name}, ${email}, 'supabase', ${role}::agricoop_app.user_role,
              'approved', ${cooperativeId}
            )
            returning id
          `;
          return user.id as number;
        };
        const activeSellerId = await createUser(
          activeSellerAuth,
          "Harness Active Public Seller",
          "harness-active-public-seller@example.test",
          "seller",
          cooperative.id,
        );
        const deletedSellerId = await createUser(
          deletedSellerAuth,
          "Harness Deleted Public Seller",
          "harness-deleted-public-seller@example.test",
          "seller",
          cooperative.id,
        );
        const superAdminId = await createUser(
          superAdminAuth,
          "Harness Public Seller SuperAdmin",
          "harness-public-seller-superadmin@example.test",
          "superadmin",
          null,
        );

        await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values
            (
              ${activeSellerId}, ${cooperative.id}, 'Harness Active Public Listing',
              'Crop', 'Standard', 'test', 'kg', 100, 10, 1, 'standard', 'published', 'approved', 'visible'
            ),
            (
              ${deletedSellerId}, ${cooperative.id}, 'Harness Deleted Public Listing',
              'Crop', 'Standard', 'test', 'kg', 100, 10, 1, 'standard', 'published', 'approved', 'visible'
            )
        `;

        await tx`select set_config('role', 'authenticated', true)`;
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', ${superAdminAuth}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: superAdminAuth })},
          true
        )`;
        await tx`
          update agricoop_app.users
          set "deletedAt" = transaction_timestamp(),
              "deletedBy" = ${superAdminId},
              "deletedByRole" = 'superadmin'
          where id = ${deletedSellerId}
        `;

        await tx`select set_config('role', 'anon', true)`;
        await tx.unsafe("set local role anon");
        await tx`select set_config('request.jwt.claim.sub', '', true)`;
        await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
        const [publicSellerColumnPrivileges] = await tx`
          select
            has_column_privilege('anon', 'agricoop_app.users', 'id', 'SELECT') as id_select,
            has_column_privilege('anon', 'agricoop_app.users', 'name', 'SELECT') as name_select,
            has_column_privilege('anon', 'agricoop_app.users', 'role', 'SELECT') as role_select,
            has_column_privilege('anon', 'agricoop_app.users', 'approvalStatus', 'SELECT') as approval_select,
            has_column_privilege('anon', 'agricoop_app.users', 'deletedAt', 'SELECT') as deleted_at_select,
            has_column_privilege('anon', 'agricoop_app.users', 'email', 'SELECT') as email_select,
            has_column_privilege('anon', 'agricoop_app.users', 'phone', 'SELECT') as phone_select,
            has_column_privilege('anon', 'agricoop_app.users', 'address', 'SELECT') as address_select,
            has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentQrPath', 'SELECT') as payment_qr_select
        `;
        expect(publicSellerColumnPrivileges).toEqual({
          id_select: true,
          name_select: true,
          role_select: true,
          approval_select: true,
          deleted_at_select: true,
          email_select: false,
          phone_select: false,
          address_select: false,
          payment_qr_select: false,
        });
        const listings = await tx`
          select p.name, u."deletedAt"
          from agricoop_app.products p
          inner join agricoop_app.users u on u.id = p."sellerId"
          where p."cooperativeId" = ${cooperative.id}
            and p.status = 'published'
            and p."verificationStatus" = 'approved'
            and p.visibility = 'visible'
            and p."deletedAt" is null
            and u."approvalStatus" = 'approved'
            and u."deletedAt" is null
          order by p.name
        `;
        expect(listings).toEqual([{ name: "Harness Active Public Listing", deletedAt: null }]);
        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("registers a Buyer with a selected cooperative and reads the login row under authenticated role", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const authUserId = "11111111-1111-4111-8111-111111111111";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values (${authUserId}::uuid, 'harness-buyer@example.test')
          on conflict (id) do nothing`;
        const [selectedCooperative] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Registration Cooperative', 'harnessregistrationcooperative',
            'Test City', 'Barangay 7', 'testcity7', 'active', 'seed'
          )
          returning id
        `;
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

        // Match auth.register's first-time NULL -> cooperativeId assignment.
        await tx`select set_config('agricoop.allow_registration_coop_assign', '1', true)`;
        const assigned = await tx`
          update agricoop_app.users
          set "cooperativeId" = ${selectedCooperative.id}
          where "openId" = ${authUserId} and "cooperativeId" is null
          returning "cooperativeId"
        `;
        expect(assigned).toEqual([{ cooperativeId: selectedCooperative.id }]);

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
          select id, "openId", role, "approvalStatus", "profileImageUrl", "cooperativeId"
          from agricoop_app.users
          where "openId" = ${authUserId}
          limit 1
        `;
        expect(loginRows).toHaveLength(1);
        expect(loginRows[0].role).toBe("buyer");
        expect(loginRows[0].cooperativeId).toBe(selectedCooperative.id);

        await tx`savepoint deny_privileged_signup_fields`;
        let privilegedSignupDenied = false;
        try {
          await tx`
            insert into agricoop_app.users (
              "openId", name, email, "loginMethod", role, "approvalStatus",
              "deletedAt", "deletedBy", "deletedByRole"
            ) values (
              ${authUserId}, 'Forged Admin', 'forged-admin@example.test', 'supabase',
              'admin', 'approved', now(), 1, 'admin'
            )
          `;
        } catch (error) {
          privilegedSignupDenied = /permission denied|42501/i.test(String(error));
        }
        await tx`rollback to savepoint deny_privileged_signup_fields`;
        expect(privilegedSignupDenied).toBe(true);

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

      expect(await sql`
        select has_column_privilege(
          'authenticated',
          'agricoop_app."cooperativeAdminApplications"',
          'userId',
          'INSERT'
        ) as ok
      `.then(rows => rows[0]?.ok)).toBe(true);
      expect(await sql`
        select has_column_privilege('authenticated', 'agricoop_app.products', 'updatedAt', 'INSERT') as ok
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

  it("limits cooperative writes to the assigned Admin and SuperAdmin (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const adminAuth = "24242424-2424-4424-8424-242424242424";
    const unassignedAdminAuth = "25252525-2525-4525-8525-252525252525";
    const superAdminAuth = "26262626-2626-4626-8626-262626262626";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${adminAuth}::uuid, 'harness-coop-admin@example.test'),
          (${unassignedAdminAuth}::uuid, 'harness-coop-unassigned@example.test'),
          (${superAdminAuth}::uuid, 'harness-coop-superadmin@example.test')
          on conflict (id) do nothing`;
        const [ownCooperative] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Cooperative Scope Own', 'harnesscoopscopeown',
            'Test City', 'Barangay 8', 'testcity8', 'active', 'seed'
          )
          returning id
        `;
        const [otherCooperative] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Cooperative Scope Other', 'harnesscoopscopeother',
            'Test City', 'Barangay 9', 'testcity9', 'active', 'seed'
          )
          returning id
        `;
        await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
          ) values
            (${adminAuth}, 'Harness Coop Admin', 'harness-coop-admin@example.test', 'supabase', 'admin', 'approved', ${ownCooperative.id}),
            (${unassignedAdminAuth}, 'Harness Unassigned Admin', 'harness-coop-unassigned@example.test', 'supabase', 'admin', 'approved', null),
            (${superAdminAuth}, 'Harness Coop SuperAdmin', 'harness-coop-superadmin@example.test', 'supabase', 'superadmin', 'approved', null)
        `;

        const asAuth = async (openId: string, fn: () => Promise<void>) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${openId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: openId })},
            true
          )`;
          await fn();
        };

        await asAuth(adminAuth, async () => {
          expect(await tx`
            update agricoop_app.cooperatives
            set description = 'Updated by assigned Admin'
            where id = ${ownCooperative.id}
            returning id
          `).toHaveLength(1);
          expect(await tx`
            update agricoop_app.cooperatives
            set description = 'Cross-cooperative update attempt'
            where id = ${otherCooperative.id}
            returning id
          `).toEqual([]);
        });

        await asAuth(unassignedAdminAuth, async () => {
          expect(await tx`
            update agricoop_app.cooperatives
            set description = 'Unassigned Admin update attempt'
            where id = ${otherCooperative.id}
            returning id
          `).toEqual([]);
        });

        await asAuth(superAdminAuth, async () => {
          expect(await tx`
            update agricoop_app.cooperatives
            set description = 'Updated by SuperAdmin'
            where id = ${otherCooperative.id}
            returning id
          `).toHaveLength(1);
        });

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("isolates archive and delete state by owner and dedicated channel (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const buyerAAuth = "12121212-1212-4212-8212-121212121212";
    const buyerBAuth = "13131313-1313-4313-8313-131313131313";
    const sellerAuth = "14141414-1414-4414-8414-141414141414";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${buyerAAuth}::uuid, 'harness-archive-a@example.test'),
          (${buyerBAuth}::uuid, 'harness-archive-b@example.test'),
          (${sellerAuth}::uuid, 'harness-archive-seller@example.test')
          on conflict (id) do nothing`;
        const [buyerA] = await tx`
          insert into agricoop_app.users ("openId", name, email, "loginMethod", role, "approvalStatus")
          values (${buyerAAuth}, 'Archive Buyer A', 'harness-archive-a@example.test', 'supabase', 'buyer', 'approved')
          returning id
        `;
        const [buyerB] = await tx`
          insert into agricoop_app.users ("openId", name, email, "loginMethod", role, "approvalStatus")
          values (${buyerBAuth}, 'Archive Buyer B', 'harness-archive-b@example.test', 'supabase', 'buyer', 'approved')
          returning id
        `;
        const [seller] = await tx`
          insert into agricoop_app.users ("openId", name, email, "loginMethod", role, "approvalStatus")
          values (${sellerAuth}, 'Archive Seller', 'harness-archive-seller@example.test', 'supabase', 'seller', 'approved')
          returning id
        `;
        await tx`
          insert into agricoop_app."threadStates" ("userId", channel, "threadId")
          values
            (${buyerA.id}, 'order', 42),
            (${buyerB.id}, 'order', 42),
            (${seller.id}, 'seller_order', 42),
            (${seller.id}, 'quotation', 42)
        `;

        const asAuth = async (openId: string, fn: () => Promise<void>) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${openId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: openId })},
            true
          )`;
          await fn();
        };

        await asAuth(buyerAAuth, async () => {
          const ownState = await tx`
            update agricoop_app."threadStates"
            set "archivedAt" = now()
            where "userId" = ${buyerA.id} and channel = 'order' and "threadId" = 42
            returning id
          `;
          expect(ownState).toHaveLength(1);
          const anotherBuyer = await tx`
            update agricoop_app."threadStates"
            set "deletedAt" = now()
            where "userId" = ${buyerB.id} and channel = 'order' and "threadId" = 42
            returning id
          `;
          expect(anotherBuyer).toHaveLength(0);
          expect(await tx`
            select channel, "archivedAt" is not null as archived
            from agricoop_app."threadStates"
            where "userId" = ${buyerA.id}
          `).toEqual([{ channel: "order", archived: true }]);
        });

        await asAuth(sellerAuth, async () => {
          const sellerOrder = await tx`
            update agricoop_app."threadStates"
            set "archivedAt" = now()
            where "userId" = ${seller.id} and channel = 'seller_order' and "threadId" = 42
            returning id
          `;
          const quotation = await tx`
            update agricoop_app."threadStates"
            set "deletedAt" = now()
            where "userId" = ${seller.id} and channel = 'quotation' and "threadId" = 42
            returning id
          `;
          expect(sellerOrder).toHaveLength(1);
          expect(quotation).toHaveLength(1);
          expect(await tx`
            select channel from agricoop_app."threadStates"
            where "userId" = ${seller.id}
            order by channel
          `).toEqual([{ channel: "quotation" }, { channel: "seller_order" }]);
        });

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enforces cooperative association request eligibility and approval (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const sellerAAuth = "15151515-1515-4515-8515-151515151515";
    const sellerBAuth = "16161616-1616-4616-8616-161616161616";
    const sameCoopAuth = "17171717-1717-4717-8717-171717171717";
    const suspendedAuth = "18181818-1818-4818-8818-181818181818";
    const buyerAuth = "19191919-1919-4919-8919-191919191919";
    const adminAuth = "20202020-2020-4020-8020-202020202020";
    const otherAdminAuth = "22222222-2222-4222-8222-222222222222";
    const superAdminAuth = "23232323-2323-4323-8323-232323232323";
    const pendingAdminAuth = "24242424-2424-4424-8424-242424242424";
    const suspendedAdminAuth = "25252525-2525-4525-8525-252525252525";
    const deletedAdminAuth = "26262626-2626-4626-8626-262626262626";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${sellerAAuth}::uuid, 'harness-assoc-a@example.test'),
          (${sellerBAuth}::uuid, 'harness-assoc-b@example.test'),
          (${sameCoopAuth}::uuid, 'harness-assoc-same@example.test'),
          (${suspendedAuth}::uuid, 'harness-assoc-suspended@example.test'),
          (${buyerAuth}::uuid, 'harness-assoc-buyer@example.test'),
          (${adminAuth}::uuid, 'harness-assoc-admin@example.test'),
          (${otherAdminAuth}::uuid, 'harness-assoc-other-admin@example.test'),
          (${superAdminAuth}::uuid, 'harness-assoc-superadmin@example.test'),
          (${pendingAdminAuth}::uuid, 'harness-assoc-pending-admin@example.test'),
          (${suspendedAdminAuth}::uuid, 'harness-assoc-suspended-admin@example.test'),
          (${deletedAdminAuth}::uuid, 'harness-assoc-deleted-admin@example.test'),
          ('e2000000-0000-4000-8000-000000000001'::uuid, 'harness-assoc-pending-superadmin@example.test'),
          ('e2000000-0000-4000-8000-000000000002'::uuid, 'harness-assoc-suspended-superadmin@example.test'),
          ('e2000000-0000-4000-8000-000000000003'::uuid, 'harness-assoc-deleted-superadmin@example.test')
          on conflict (id) do nothing`;
        const [sourceCoop] = await tx`
          insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
          values ('Harness Association Source', 'harnessassociationsource', 'Test City', 'Barangay 4', 'testcity4', 'active', 'seed')
          returning id
        `;
        const [targetCoop] = await tx`
          insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
          values ('Harness Association Target', 'harnessassociationtarget', 'Test City', 'Barangay 5', 'testcity5', 'active', 'seed')
          returning id
        `;
        const [inactiveCoop] = await tx`
          insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
          values ('Harness Association Inactive', 'harnessassociationinactive', 'Test City', 'Barangay 6', 'testcity6', 'inactive', 'seed')
          returning id
        `;
        const createUser = async (
          openId: string,
          email: string,
          role: "buyer" | "seller" | "admin" | "superadmin",
          cooperativeId: number | null,
          approvalStatus: "approved" | "pending" | "suspended",
        ) => {
          const [user] = await tx`
            insert into agricoop_app.users (
              "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
            ) values (
              ${openId}, ${email}, ${email}, 'supabase', ${role}::agricoop_app.user_role,
              ${approvalStatus}::agricoop_app.user_approval_status, ${cooperativeId}
            )
            returning id
          `;
          return user.id as number;
        };
        const sellerAId = await createUser(sellerAAuth, "harness-assoc-a@example.test", "seller", sourceCoop.id, "approved");
        const sellerBId = await createUser(sellerBAuth, "harness-assoc-b@example.test", "seller", sourceCoop.id, "approved");
        const sameCoopSellerId = await createUser(sameCoopAuth, "harness-assoc-same@example.test", "seller", targetCoop.id, "approved");
        const suspendedSellerId = await createUser(suspendedAuth, "harness-assoc-suspended@example.test", "seller", null, "suspended");
        const buyerId = await createUser(buyerAuth, "harness-assoc-buyer@example.test", "buyer", null, "approved");
        const adminId = await createUser(adminAuth, "harness-assoc-admin@example.test", "admin", targetCoop.id, "approved");
        await createUser(otherAdminAuth, "harness-assoc-other-admin@example.test", "admin", sourceCoop.id, "approved");
        const superAdminId = await createUser(
          superAdminAuth,
          "harness-assoc-superadmin@example.test",
          "superadmin",
          null,
          "approved",
        );
        await createUser(pendingAdminAuth, "harness-assoc-pending-admin@example.test", "admin", targetCoop.id, "pending");
        await createUser(suspendedAdminAuth, "harness-assoc-suspended-admin@example.test", "admin", targetCoop.id, "suspended");
        const deletedAdminId = await createUser(
          deletedAdminAuth,
          "harness-assoc-deleted-admin@example.test",
          "admin",
          targetCoop.id,
          "approved",
        );
        const pendingSuperAdminAuth = "e2000000-0000-4000-8000-000000000001";
        const suspendedSuperAdminAuth = "e2000000-0000-4000-8000-000000000002";
        const deletedSuperAdminAuth = "e2000000-0000-4000-8000-000000000003";
        await createUser(
          pendingSuperAdminAuth,
          "harness-assoc-pending-superadmin@example.test",
          "superadmin",
          null,
          "pending",
        );
        await createUser(
          suspendedSuperAdminAuth,
          "harness-assoc-suspended-superadmin@example.test",
          "superadmin",
          null,
          "suspended",
        );
        const deletedSuperAdminId = await createUser(
          deletedSuperAdminAuth,
          "harness-assoc-deleted-superadmin@example.test",
          "superadmin",
          null,
          "approved",
        );
        const [legacyCooperative] = await tx`
          insert into public.cooperatives (cooperative_id)
          values (gen_random_uuid())
          returning cooperative_id
        `;
        await tx`
          insert into public.profiles (user_id, full_name, email, role_id, cooperative_id)
          values
            (${adminAuth}::uuid, 'Harness active admin', 'harness-assoc-admin@example.test', 3, ${legacyCooperative.cooperative_id}),
            (${deletedAdminAuth}::uuid, 'Harness deleted admin', 'harness-assoc-deleted-admin@example.test', 3, ${legacyCooperative.cooperative_id}),
            (${pendingSuperAdminAuth}::uuid, 'Harness pending platform admin', 'harness-assoc-pending-superadmin@example.test', 4, ${legacyCooperative.cooperative_id}),
            (${suspendedSuperAdminAuth}::uuid, 'Harness suspended platform admin', 'harness-assoc-suspended-superadmin@example.test', 4, ${legacyCooperative.cooperative_id}),
            (${deletedSuperAdminAuth}::uuid, 'Harness deleted platform admin', 'harness-assoc-deleted-superadmin@example.test', 4, ${legacyCooperative.cooperative_id}),
            (${sellerAAuth}::uuid, 'Harness seller', 'harness-assoc-a@example.test', 2, ${legacyCooperative.cooperative_id})
        `;
        expect([sameCoopSellerId, suspendedSellerId, buyerId, adminId]).toHaveLength(4);
        const [productA] = await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values (
            ${sellerAId}, ${sourceCoop.id}, 'Harness Association Product A', 'Crop', 'Standard', 'test', 'kg',
            100, 10, 1, 'standard', 'published', 'approved', 'visible'
          ) returning id
        `;
        const [productB] = await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values (
            ${sellerBId}, ${sourceCoop.id}, 'Harness Association Product B', 'Crop', 'Standard', 'test', 'kg',
            100, 10, 1, 'standard', 'published', 'approved', 'visible'
          ) returning id
        `;

        const asAuth = async (openId: string, fn: () => Promise<void>) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${openId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: openId })},
            true
          )`;
          await fn();
        };
        await asAuth(superAdminAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedAt" = transaction_timestamp(),
                "deletedBy" = ${superAdminId},
                "deletedByRole" = 'superadmin'
            where id = ${deletedAdminId}
          `;
        });
        await tx.unsafe("reset role");
        // Simulate a legacy tombstone; the current trigger intentionally prevents creating one.
        await tx.unsafe("set local session_replication_role = replica");
        await tx`
          update agricoop_app.users
          set "deletedAt" = transaction_timestamp(),
              "deletedBy" = ${superAdminId},
              "deletedByRole" = 'superadmin'
          where id = ${deletedSuperAdminId}
        `;
        await tx.unsafe("set local session_replication_role = origin");
        let savepoint = 0;
        const expectRejected = async (
          openId: string,
          statement: () => Promise<unknown>,
          expectedCode: string,
        ) => {
          savepoint += 1;
          const point = `assoc_rejected_${savepoint}`;
          await tx.unsafe(`savepoint ${point}`);
          let actualCode = "";
          try {
            await asAuth(openId, statement);
          } catch (error) {
            actualCode = error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "";
          }
          await tx.unsafe(`rollback to savepoint ${point}`);
          expect(actualCode).toBe(expectedCode);
        };

        await expectRejected(adminAuth, async () => {
          await tx`
            update agricoop_app.users
            set role = 'admin'
            where id = ${sameCoopSellerId}
          `;
        }, "P0001");

        await expectRejected(sellerAAuth, async () => {
          await tx`
            update agricoop_app.users
            set role = 'admin'
            where id = ${sellerAId}
          `;
        }, "P0001");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            update agricoop_app.users
            set "approvalStatus" = 'suspended'
            where id = ${sellerAId}
          `;
        }, "P0001");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            update agricoop_app.users
            set "cooperativeId" = ${targetCoop.id}
            where id = ${sellerAId}
          `;
        }, "P0001");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            select agricoop_app.sync_profile_role_from_app(${sellerAAuth}, 'superadmin')
          `;
        }, "42501");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            select agricoop_app.sync_profile_role_from_app(${sellerBAuth}, 'seller')
          `;
        }, "42501");
        const [sellerBeforeApproval] = await tx`
          select "cooperativeId" from agricoop_app.users where id = ${sellerAId}
        `;
        expect(sellerBeforeApproval.cooperativeId).toBe(sourceCoop.id);

        await expectRejected(sameCoopAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sameCoopSellerId}, ${targetCoop.id}, 'Already assigned')
          `;
        }, "23514");
        await expectRejected(suspendedAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${suspendedSellerId}, ${targetCoop.id}, 'Please associate me')
          `;
        }, "42501");
        await expectRejected(buyerAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${buyerId}, ${targetCoop.id}, 'Please associate me')
          `;
        }, "42501");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerAId}, ${inactiveCoop.id}, 'Please associate me')
          `;
        }, "23514");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerAId}, ${targetCoop.id}, '   ')
          `;
        }, "22023");
        await expectRejected(sellerAAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" (
              "sellerId", "cooperativeId", status, message, "reviewedBy", "reviewedAt", "reviewNote"
            ) values (
              ${sellerAId}, ${targetCoop.id}, 'approved', 'Forged review',
              ${adminId}, transaction_timestamp(), 'Forged note'
            )
          `;
        }, "42501");

        let requestAId = 0;
        await asAuth(sellerAAuth, async () => {
          const [request] = await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerAId}, ${targetCoop.id}, 'Moving to this cooperative')
            returning id
          `;
          requestAId = request.id as number;
        });
        const [requestUpdatePrivileges] = await tx`
          select
            has_table_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'UPDATE') as table_update,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'status', 'UPDATE') as status_update,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'reviewedBy', 'UPDATE') as reviewed_by_update,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'reviewedAt', 'UPDATE') as reviewed_at_update,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'reviewNote', 'UPDATE') as review_note_update,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'moveExistingListings', 'UPDATE') as move_listings_update
        `;
        expect(requestUpdatePrivileges).toEqual({
          table_update: false,
          status_update: false,
          reviewed_by_update: false,
          reviewed_at_update: false,
          review_note_update: false,
          move_listings_update: false,
        });
        const [requestInsertPrivileges] = await tx`
          select
            has_table_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'INSERT') as table_insert,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'status', 'INSERT') as status_insert,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'reviewedBy', 'INSERT') as reviewed_by_insert,
            has_column_privilege('authenticated', 'agricoop_app."cooperativeAssociationRequests"', 'message', 'INSERT') as message_insert
        `;
        expect(requestInsertPrivileges).toEqual({
          table_insert: false,
          status_insert: false,
          reviewed_by_insert: false,
          message_insert: true,
        });

        const directRequestUpdates: Array<() => Promise<unknown>> = [
          () => tx`update agricoop_app."cooperativeAssociationRequests" set status = 'approved' where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set "reviewedBy" = ${adminId} where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set "reviewedAt" = transaction_timestamp() where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set "reviewNote" = 'Direct update attempt' where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set "moveExistingListings" = true where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set message = 'Tampered request' where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set "cooperativeId" = ${sourceCoop.id} where id = ${requestAId}`,
          () => tx`update agricoop_app."cooperativeAssociationRequests" set "sellerId" = ${sellerBId} where id = ${requestAId}`,
        ];
        for (const updateRequest of directRequestUpdates) {
          await expectRejected(adminAuth, updateRequest, "42501");
        }

        const [requestAfterDirectAttempts] = await tx`
          select status::text as status, "reviewedBy", "reviewedAt", "reviewNote", "moveExistingListings", message
          from agricoop_app."cooperativeAssociationRequests"
          where id = ${requestAId}
        `;
        expect(requestAfterDirectAttempts).toEqual({
          status: "pending",
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          moveExistingListings: false,
          message: "Moving to this cooperative",
        });

        const inactiveStaff = [
          { authId: pendingAdminAuth, role: "admin" },
          { authId: suspendedAdminAuth, role: "admin" },
          { authId: deletedAdminAuth, role: "admin" },
          { authId: pendingSuperAdminAuth, role: "superadmin" },
          { authId: suspendedSuperAdminAuth, role: "superadmin" },
          { authId: deletedSuperAdminAuth, role: "superadmin" },
        ] as const;
        for (const inactiveActor of inactiveStaff) {
          await asAuth(inactiveActor.authId, async () => {
            const [actorRole] = await tx`select agricoop_app.current_app_role() as role`;
            expect(actorRole.role).toBeNull();
            const [actorFlags] = await tx`
              select coalesce(agricoop_app.is_staff(), false) as is_staff,
                     coalesce(agricoop_app.is_superadmin(), false) as is_superadmin
            `;
            expect(actorFlags).toEqual({ is_staff: false, is_superadmin: false });
            const [canReview] = await tx`
              select agricoop_app.can_review_profile_verification_user(${sellerAId}) as allowed
            `;
            expect(canReview.allowed).toBe(false);
            const [publicRole] = await tx`select public.get_my_role() as role`;
            expect(publicRole.role).toBeNull();
            const [profileVisible] = await tx`
              select public.agricoop_profile_visible(${sellerAAuth}::uuid) as visible
            `;
            expect(profileVisible.visible).toBe(false);
          });
          await expectRejected(inactiveActor.authId, async () => {
            await tx`
              select agricoop_app.approve_cooperative_association_request(
                ${requestAId}, 'Inactive staff must not approve requests', false
              )
            `;
          }, "42501");
          await expectRejected(inactiveActor.authId, async () => {
            await tx`
              select agricoop_app.reject_cooperative_association_request(
                ${requestAId}, 'Inactive staff must not reject requests'
              )
            `;
          }, "42501");
          await expectRejected(inactiveActor.authId, async () => {
            await tx`
              select agricoop_app.sync_profile_role_from_app(
                ${inactiveActor.authId}, ${inactiveActor.role}
              )
            `;
          }, "42501");
        }
        await asAuth(adminAuth, async () => {
          const [role] = await tx`select public.get_my_role() as role`;
          expect(role.role).toBe("coop_officer");
          const [visibility] = await tx`
            select public.agricoop_profile_visible(${sellerAAuth}::uuid) as visible
          `;
          expect(visibility.visible).toBe(true);
        });
        await asAuth(deletedAdminAuth, async () => {
          const [role] = await tx`select public.get_my_role() as role`;
          expect(role.role).toBeNull();
          const [visibility] = await tx`
            select public.agricoop_profile_visible(${sellerAAuth}::uuid) as visible
          `;
          expect(visibility.visible).toBe(false);
          const [selfVisibility] = await tx`
            select public.agricoop_profile_visible(${deletedAdminAuth}::uuid) as visible
          `;
          expect(selfVisibility.visible).toBe(false);
        });
        await asAuth(sellerAAuth, async () => {
          const [selfVisibility] = await tx`
            select public.agricoop_profile_visible(${sellerAAuth}::uuid) as visible
          `;
          expect(selfVisibility.visible).toBe(true);
        });

        await expectRejected(sellerAAuth, async () => {
          await tx`
            select agricoop_app.approve_cooperative_association_request(
              ${requestAId}, 'Seller must not approve requests', false
            )
          `;
        }, "42501");
        await expectRejected(otherAdminAuth, async () => {
          await tx`
            select agricoop_app.approve_cooperative_association_request(
              ${requestAId}, 'Wrong cooperative', false
            )
          `;
        }, "42501");
        await expectRejected(otherAdminAuth, async () => {
          await tx`
            select agricoop_app.reject_cooperative_association_request(
              ${requestAId}, 'Wrong cooperative'
            )
          `;
        }, "42501");

        await expectRejected(sellerAAuth, async () => {
          await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerAId}, ${targetCoop.id}, 'Second pending request')
          `;
        }, "23505");

        await asAuth(adminAuth, async () => {
          await tx`
            select agricoop_app.approve_cooperative_association_request(
              ${requestAId}, 'Approved; leave listings in their current cooperative', false
            )
          `;
        });

        let requestBId = 0;
        await asAuth(sellerBAuth, async () => {
          const [request] = await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerBId}, ${targetCoop.id}, 'Move with existing listings')
            returning id
          `;
          requestBId = request.id as number;
        });
        await asAuth(superAdminAuth, async () => {
          await tx`
            select agricoop_app.approve_cooperative_association_request(
              ${requestBId}, 'Approved with listing move', true
            )
          `;
        });

        let requestCId = 0;
        await asAuth(sellerBAuth, async () => {
          const [request] = await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerBId}, ${sourceCoop.id}, 'Returning to the source cooperative')
            returning id
          `;
          requestCId = request.id as number;
        });
        await asAuth(otherAdminAuth, async () => {
          await tx`
            select agricoop_app.reject_cooperative_association_request(
              ${requestCId}, 'Request rejected by the source cooperative'
            )
          `;
        });
        let requestDId = 0;
        await asAuth(sellerAAuth, async () => {
          const [request] = await tx`
            insert into agricoop_app."cooperativeAssociationRequests" ("sellerId", "cooperativeId", message)
            values (${sellerAId}, ${sourceCoop.id}, 'Platform-wide review test')
            returning id
          `;
          requestDId = request.id as number;
        });
        await asAuth(superAdminAuth, async () => {
          await tx`
            select agricoop_app.reject_cooperative_association_request(
              ${requestDId}, 'Platform-wide SuperAdmin rejection'
            )
          `;
        });

        await tx.unsafe("reset role");
        const [rejectedRequest] = await tx`
          select status::text as status, "reviewedBy", "reviewNote", "moveExistingListings"
          from agricoop_app."cooperativeAssociationRequests"
          where id = ${requestCId}
        `;
        expect(rejectedRequest).toEqual({
          status: "rejected",
          reviewedBy: expect.any(Number),
          reviewNote: "Request rejected by the source cooperative",
          moveExistingListings: false,
        });
        const [superAdminRejectedRequest] = await tx`
          select status::text as status, "reviewedBy", "reviewNote", "moveExistingListings"
          from agricoop_app."cooperativeAssociationRequests"
          where id = ${requestDId}
        `;
        expect(superAdminRejectedRequest).toEqual({
          status: "rejected",
          reviewedBy: superAdminId,
          reviewNote: "Platform-wide SuperAdmin rejection",
          moveExistingListings: false,
        });
        const assignments = await tx`
          select id, "cooperativeId" from agricoop_app.products
          where id in (${productA.id}, ${productB.id})
          order by id
        `;
        expect(assignments).toEqual([
          { id: productA.id, cooperativeId: sourceCoop.id },
          { id: productB.id, cooperativeId: targetCoop.id },
        ]);
        const sellerAssignments = await tx`
          select id, "cooperativeId" from agricoop_app.users
          where id in (${sellerAId}, ${sellerBId})
          order by id
        `;
        expect(sellerAssignments).toEqual([
          { id: sellerAId, cooperativeId: targetCoop.id },
          { id: sellerBId, cooperativeId: targetCoop.id },
        ]);

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
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

  it("rejects unauthorized user soft-delete field changes under authenticated role", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const sellerAuth = "27272727-2727-4727-8727-272727272727";
    const adminAuth = "28282828-2828-4828-8828-282828282828";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${sellerAuth}::uuid, 'harness-soft-delete-seller@example.test'),
          (${adminAuth}::uuid, 'harness-soft-delete-admin@example.test')
          on conflict (id) do nothing`;
        const [cooperative] = await tx`
          insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
          values ('Harness User Tombstone Coop', 'harnessusertombstonecoop', 'Test City', 'Barangay 7', 'testcity7', 'active', 'seed')
          returning id
        `;
        const [seller] = await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
          ) values (
            ${sellerAuth}, 'Harness Tombstone Seller', 'harness-soft-delete-seller@example.test',
            'supabase', 'seller', 'approved', ${cooperative.id}
          ) returning id
        `;
        const [admin] = await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
          ) values (
            ${adminAuth}, 'Harness Tombstone Admin', 'harness-soft-delete-admin@example.test',
            'supabase', 'admin', 'approved', ${cooperative.id}
          ) returning id
        `;
        const asAuth = async (openId: string, fn: () => Promise<void>) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${openId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: openId })},
            true
          )`;
          await fn();
        };
        let savepoint = 0;
        const expectRejected = async (openId: string, statement: () => Promise<unknown>) => {
          savepoint += 1;
          const point = `user_tombstone_rejected_${savepoint}`;
          await tx.unsafe(`savepoint ${point}`);
          let actualCode = "";
          try {
            await asAuth(openId, statement);
          } catch (error) {
            actualCode = error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "";
          }
          await tx.unsafe(`rollback to savepoint ${point}`);
          expect(actualCode).toBe("42501");
        };

        await expectRejected(sellerAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedAt" = transaction_timestamp()
            where id = ${seller.id}
          `;
        });
        await expectRejected(sellerAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedBy" = ${admin.id}
            where id = ${seller.id}
          `;
        });
        await expectRejected(sellerAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedByRole" = 'admin'
            where id = ${seller.id}
          `;
        });
        await expectRejected(adminAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedAt" = transaction_timestamp(),
                "deletedBy" = ${admin.id},
                "deletedByRole" = 'admin'
            where id = ${admin.id}
          `;
        });
        await expectRejected(adminAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedAt" = transaction_timestamp(),
                "deletedBy" = ${admin.id},
                "deletedByRole" = 'superadmin'
            where id = ${seller.id}
          `;
        });

        await asAuth(adminAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedAt" = transaction_timestamp(),
                "deletedBy" = ${admin.id},
                "deletedByRole" = 'admin'
            where id = ${seller.id}
          `;
        });
        await expectRejected(sellerAuth, async () => {
          await tx`
            update agricoop_app.users
            set "deletedAt" = null, "deletedBy" = null, "deletedByRole" = null
            where id = ${seller.id}
            returning id
          `;
        });
        await tx.unsafe("reset role");
        const [deletedSeller] = await tx`
          select "deletedAt", "deletedBy", "deletedByRole"
          from agricoop_app.users
          where id = ${seller.id}
        `;
        expect(deletedSeller.deletedAt).not.toBeNull();
        expect(deletedSeller.deletedBy).toBe(admin.id);
        expect(deletedSeller.deletedByRole).toBe("admin");

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("denies forged legacy audit inserts and hides inventory for non-marketplace products", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const sellerAuth = "29292929-2929-4929-8929-292929292929";
    const otherSellerAuth = "30303030-3030-4030-8030-303030303030";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${sellerAuth}::uuid, 'harness-legacy-seller@example.test'),
          (${otherSellerAuth}::uuid, 'harness-legacy-other@example.test')
          on conflict (id) do nothing`;
        const [activeProduct] = await tx`
          insert into public.products (product_id, seller_id, status)
          values (gen_random_uuid(), ${otherSellerAuth}::uuid, 'active')
          returning product_id
        `;
        const [otherDraft] = await tx`
          insert into public.products (product_id, seller_id, status)
          values (gen_random_uuid(), ${otherSellerAuth}::uuid, 'draft')
          returning product_id
        `;
        const [sellerDraft] = await tx`
          insert into public.products (product_id, seller_id, status)
          values (gen_random_uuid(), ${sellerAuth}::uuid, 'draft')
          returning product_id
        `;
        await tx`
          insert into public.inventory (product_id, stock_quantity)
          values
            (${activeProduct.product_id}, 10),
            (${otherDraft.product_id}, 20),
            (${sellerDraft.product_id}, 30)
        `;

        const setRole = async (role: "anon" | "authenticated", subject: string) => {
          await tx.unsafe("reset role");
          await tx`select set_config('role', ${role}, true)`;
          await tx.unsafe(`set local role ${role}`);
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${subject}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: role, role, ...(subject ? { sub: subject } : {}) })},
            true
          )`;
        };
        let savepoint = 0;
        const expectAuditInsertRejected = async (role: "anon" | "authenticated", subject: string) => {
          savepoint += 1;
          const point = `legacy_audit_rejected_${savepoint}`;
          await tx.unsafe(`savepoint ${point}`);
          let actualCode = "";
          try {
            await setRole(role, subject);
            await tx`
              insert into public.activity_logs (user_id, action_performed)
              values (${subject || null}::uuid, 'Forged audit entry')
            `;
          } catch (error) {
            actualCode = error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "";
          }
          await tx.unsafe(`rollback to savepoint ${point}`);
          expect(actualCode).toBe("42501");
        };

        await setRole("anon", "");
        const anonymousInventory = await tx`
          select product.product_id, inventory.stock_quantity
          from public.inventory AS inventory
          join public.products AS product ON product.product_id = inventory.product_id
          order by inventory.stock_quantity
        `;
        expect(anonymousInventory).toEqual([
          { product_id: activeProduct.product_id, stock_quantity: "10" },
        ]);
        await setRole("authenticated", sellerAuth);
        const sellerInventory = await tx`
          select product.product_id, inventory.stock_quantity
          from public.inventory AS inventory
          join public.products AS product ON product.product_id = inventory.product_id
          order by inventory.stock_quantity
        `;
        expect(sellerInventory).toEqual([
          { product_id: activeProduct.product_id, stock_quantity: "10" },
          { product_id: sellerDraft.product_id, stock_quantity: "30" },
        ]);
        await expectAuditInsertRejected("anon", "");
        await expectAuditInsertRejected("authenticated", sellerAuth);
        await tx.unsafe("reset role");
        const [auditPrivileges] = await tx`
          select
            has_table_privilege('anon', 'public.activity_logs', 'INSERT') as anon_insert,
            has_table_privilege('authenticated', 'public.activity_logs', 'INSERT') as authenticated_insert,
            exists (
              select 1 from pg_policy
              where polrelid = 'public.activity_logs'::regclass
                and polname = 'system inserts logs'
            ) as legacy_insert_policy
        `;
        expect(auditPrivileges).toEqual({
          anon_insert: false,
          authenticated_insert: false,
          legacy_insert_policy: false,
        });
        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("requires the server-scoped path for SECURITY DEFINER audit writes", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const buyerAuth = "e3000000-0000-4000-8000-000000000001";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email)
          values (${buyerAuth}::uuid, 'harness-audit-writer@example.test')
          on conflict (id) do nothing`;
        const [buyer] = await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus"
          ) values (
            ${buyerAuth}, 'Harness Audit Writer', 'harness-audit-writer@example.test',
            'supabase', 'buyer', 'approved'
          )
          returning id
        `;

        const setAuthenticated = async () => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${buyerAuth}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: buyerAuth })},
            true
          )`;
        };

        await tx`select set_config('agricoop.server_audit_write', 'off', true)`;
        await tx.unsafe("savepoint direct_audit_call");
        let directCallCode = "";
        try {
          await setAuthenticated();
          await tx`
            select agricoop_app.write_audit_log(
              'support_ticket_created', 'support_ticket', 7001, null, 'forged direct call'
            )
          `;
        } catch (error) {
          directCallCode = error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "";
        }
        await tx.unsafe("rollback to savepoint direct_audit_call");
        expect(directCallCode).toBe("42501");

        await setAuthenticated();
        await tx`
          with trusted_audit_scope as materialized (
            select set_config('agricoop.server_audit_write', 'on', true)
          )
          select agricoop_app.write_audit_log(
            'support_ticket_created', 'support_ticket', 7002, null, 'server path'
          )
          from trusted_audit_scope
        `;
        await tx.unsafe("reset role");
        const [auditPrivileges] = await tx`
          select
            has_any_column_privilege('authenticated', 'agricoop_app."auditLogs"', 'INSERT') as direct_insert,
            has_function_privilege(
              'authenticated',
              'agricoop_app.write_audit_log(varchar,varchar,integer,integer,text)',
              'EXECUTE'
            ) as function_execute
        `;
        expect(auditPrivileges).toEqual({ direct_insert: false, function_execute: true });
        const auditRows = await tx`
          select "actorUserId", action, "entityType", "entityId", metadata
          from agricoop_app."auditLogs"
          where "entityId" = 7002
        `;
        expect(auditRows).toEqual([{
          actorUserId: buyer.id,
          action: "support_ticket_created",
          entityType: "support_ticket",
          entityId: 7002,
          metadata: "server path",
        }]);
        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
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
          has_column_privilege('authenticated', 'agricoop_app.products', 'visibility', 'UPDATE') as visibility_upd,
          has_column_privilege('authenticated', 'agricoop_app.products', 'deletedAt', 'UPDATE') as deleted_at_upd,
          has_column_privilege('authenticated', 'agricoop_app.products', 'deletedBy', 'UPDATE') as deleted_by_upd,
          has_column_privilege('anon', 'agricoop_app.products', 'deletedAt', 'UPDATE') as anon_deleted_at_upd,
          exists(
            select 1 from information_schema.columns
            where table_schema = 'agricoop_app'
              and table_name = 'products'
              and column_name = 'deletedAt'
          ) as products_deleted_at,
          exists(
            select 1 from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'agricoop_app'
              and c.relname = 'products'
              and t.tgname = 'trg_guard_products_deleted_by'
              and not t.tgisinternal
          ) as deleted_by_guard
      `;
      expect(row.status_upd).toBe(true);
      expect(row.visibility_upd).toBe(true);
      // BLOCK 26: soft Delete uses deletedAt/deletedBy tombstones (+ status/visibility).
      expect(row.products_deleted_at).toBe(true);
      expect(row.deleted_at_upd).toBe(true);
      expect(row.deleted_by_upd).toBe(true);
      expect(row.anon_deleted_at_upd).toBe(false);
      expect(row.deleted_by_guard).toBe(true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("denies Sellers access to payment columns, receipts, and the system QR (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const sellerAuth = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const buyerAuth = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    try {
      const [verificationBucket] = await sql`
        select public, file_size_limit, allowed_mime_types
        from storage.buckets
        where id = 'profile-verification-documents'
      `;
      expect({
        ...verificationBucket,
        file_size_limit: Number(verificationBucket?.file_size_limit),
      }).toEqual({
        public: false,
        file_size_limit: 5242880,
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      });

      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${sellerAuth}::uuid, 'harness-payment-seller@example.test'),
          (${buyerAuth}::uuid, 'harness-payment-buyer@example.test')
          on conflict (id) do nothing`;
        const [coop] = await tx`
          insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
          values ('Harness Payment Privacy Coop', 'harnesspaymentprivacycoop', 'Test City', 'Barangay 3', 'testcity3', 'active', 'seed')
          returning id
        `;
        const [seller] = await tx`
          insert into agricoop_app.users ("openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId")
          values (${sellerAuth}, 'Harness Payment Seller', 'harness-payment-seller@example.test', 'supabase', 'seller', 'approved', ${coop.id})
          returning id
        `;
        const [buyer] = await tx`
          insert into agricoop_app.users ("openId", name, email, "loginMethod", role, "approvalStatus")
          values (${buyerAuth}, 'Harness Payment Buyer', 'harness-payment-buyer@example.test', 'supabase', 'buyer', 'approved')
          returning id
        `;
        const [order] = await tx`
          insert into agricoop_app.orders ("buyerId", "sellerId", "cooperativeId", "orderType", status, "paymentStatus", "totalCents")
          values (${buyer.id}, ${seller.id}, ${coop.id}, 'regular', 'submitted', 'pending', 100)
          returning id
        `;
        await tx`
          insert into agricoop_app."paymentProofs" ("orderId", "uploadedBy", "storagePath", "originalFileName", "mimeType")
          values (${order.id}, ${buyer.id}, 'payment-proofs/harness/receipt.png', 'receipt.png', 'image/png')
        `;
        await tx`
          insert into storage.buckets (id, name, public)
          values ('payment-proofs', 'payment-proofs', false)
          on conflict (id) do nothing
        `;
        await tx`
          insert into storage.objects (bucket_id, name)
          values ('payment-proofs', ${`payment-proofs/${buyer.id}/${order.id}/receipt.png`})
        `;
        await tx`
          insert into agricoop_app."systemOnlinePaymentAccounts"
            (label, "accountName", "accountNumber", "qrImagePath", "isActive")
          values ('Harness QR', 'Harness Account', '000000', 'harness/system-qr.png', false)
        `;
        await tx`
          insert into storage.objects (bucket_id, name)
          values ('system-payment-qr', 'harness/system-qr.png')
        `;
        await tx`
          insert into storage.objects (bucket_id, name)
          values (
            'profile-verification-documents',
            ${`profile-verification-documents/${seller.id}/harness.png`}
          )
        `;

        await tx`select set_config('role', 'authenticated', true)`;
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', ${sellerAuth}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: sellerAuth })},
          true
        )`;

        await tx`savepoint seller_payment_columns`;
        let paymentColumnsDenied = false;
        try {
          await tx`
            select "onlinePaymentQrPath", "onlinePaymentAccountName",
                   "onlinePaymentAccountNumber", "onlinePaymentLabel"
            from agricoop_app.users
            where id = ${seller.id}
          `;
        } catch (error) {
          paymentColumnsDenied = /permission denied|42501/i.test(String(error));
        }
        await tx`rollback to savepoint seller_payment_columns`;
        expect(paymentColumnsDenied).toBe(true);

        expect(await tx`
          select id from agricoop_app."paymentProofs" where "orderId" = ${order.id}
        `).toEqual([]);
        expect(await tx`
          select id, "qrImagePath" from agricoop_app."systemOnlinePaymentAccounts"
        `).toEqual([]);
        expect(await tx`
          select id from storage.objects where bucket_id = 'system-payment-qr'
        `).toEqual([]);
        expect(await tx`
          select id from storage.objects where bucket_id = 'payment-proofs'
        `).toEqual([]);
        expect(await tx`
          select id from storage.objects where bucket_id = 'profile-verification-documents'
        `).toEqual([]);

        // Owner-scoped upload policies (20261120140000) allow an authenticated
        // user to INSERT proof/verification objects only under their own
        // `<bucket>/<userId>/` prefix. Assert that boundary explicitly:
        // own-prefix insert succeeds, foreign prefix and uncovered buckets fail.
        await tx`savepoint seller_private_storage_insert`;
        let ownPrefixInsertAllowed = false;
        try {
          await tx`
            insert into storage.objects (bucket_id, name)
            values (
              'profile-verification-documents',
              ${`profile-verification-documents/${seller.id}/direct.png`}
            )
          `;
          ownPrefixInsertAllowed = true;
        } catch {
          ownPrefixInsertAllowed = false;
        }
        expect(ownPrefixInsertAllowed).toBe(true);

        await tx`savepoint seller_foreign_prefix_insert`;
        let foreignPrefixInsertDenied = false;
        try {
          await tx`
            insert into storage.objects (bucket_id, name)
            values (
              'profile-verification-documents',
              ${`profile-verification-documents/${buyer.id}/direct.png`}
            )
          `;
        } catch (error) {
          foreignPrefixInsertDenied = /permission denied|row-level security|42501/i.test(String(error));
        }
        await tx`rollback to savepoint seller_foreign_prefix_insert`;
        expect(foreignPrefixInsertDenied).toBe(true);

        await tx`savepoint seller_uncovered_bucket_insert`;
        let uncoveredBucketInsertDenied = false;
        try {
          await tx`
            insert into storage.objects (bucket_id, name)
            values ('system-payment-qr', 'harness/seller-direct.png')
          `;
        } catch (error) {
          uncoveredBucketInsertDenied = /permission denied|row-level security|42501/i.test(String(error));
        }
        await tx`rollback to savepoint seller_uncovered_bucket_insert`;
        expect(uncoveredBucketInsertDenied).toBe(true);

        await tx`rollback to savepoint seller_private_storage_insert`;

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("revokes buyer and seller owner-row access immediately after soft deletion (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const buyerAuth = "2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a";
    const sellerAuth = "3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b";
    const superAdminAuth = "4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c";
    try {
      await sql.begin(async tx => {
        const [cooperative] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Tombstoned Owner Cooperative', 'harnesstombstonedownercooperative',
            'Test City', 'Barangay 9', 'testcity9', 'active', 'seed'
          )
          returning id
        `;
        const createUser = async (
          openId: string,
          name: string,
          email: string,
          role: "buyer" | "seller" | "superadmin",
          cooperativeId: number | null,
        ) => {
          const [user] = await tx`
            insert into agricoop_app.users (
              "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
            ) values (
              ${openId}, ${name}, ${email}, 'supabase',
              ${role}::agricoop_app.user_role, 'approved', ${cooperativeId}
            )
            returning id
          `;
          return user.id as number;
        };
        const buyerId = await createUser(
          buyerAuth,
          "Harness Tombstoned Buyer",
          "harness-tombstoned-buyer@example.test",
          "buyer",
          null,
        );
        const sellerId = await createUser(
          sellerAuth,
          "Harness Tombstoned Seller",
          "harness-tombstoned-seller@example.test",
          "seller",
          null,
        );
        const superAdminId = await createUser(
          superAdminAuth,
          "Harness Tombstone SuperAdmin",
          "harness-tombstone-superadmin@example.test",
          "superadmin",
          null,
        );
        const [product] = await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values (
            ${sellerId}, ${cooperative.id}, 'Harness Tombstoned Owner Listing',
            'Crop', 'Standard', 'test', 'kg', 100, 10, 1, 'standard', 'published', 'pending', 'hidden'
          )
          returning id
        `;
        const [order] = await tx`
          insert into agricoop_app.orders (
            "buyerId", "sellerId", "cooperativeId", "orderType", status, "paymentStatus", "totalCents"
          ) values (
            ${buyerId}, ${sellerId}, ${cooperative.id}, 'regular', 'submitted', 'pending', 100
          )
          returning id
        `;

        const asAuthenticated = async (openId: string, fn: () => Promise<void>) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${openId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({
              aud: "authenticated",
              role: "authenticated",
              sub: openId,
              exp: Math.floor(Date.now() / 1000) + 3600,
            })},
            true
          )`;
          await fn();
        };

        await asAuthenticated(buyerAuth, async () => {
          expect(await tx`select id from agricoop_app.orders where id = ${order.id}`).toHaveLength(1);
          expect(await tx`
            update agricoop_app.orders set "buyerId" = "buyerId"
            where id = ${order.id}
            returning id
          `).toHaveLength(1);
        });
        await asAuthenticated(sellerAuth, async () => {
          expect(await tx`select id from agricoop_app.products where id = ${product.id}`).toHaveLength(1);
          expect(await tx`
            update agricoop_app.products set "priceCents" = "priceCents"
            where id = ${product.id}
            returning id
          `).toHaveLength(1);
        });

        await asAuthenticated(superAdminAuth, async () => {
          expect(await tx`
            update agricoop_app.users
            set "deletedAt" = transaction_timestamp(),
                "deletedBy" = ${superAdminId},
                "deletedByRole" = 'superadmin'
            where id in (${buyerId}, ${sellerId})
            returning id
          `).toHaveLength(2);
        });

        await asAuthenticated(buyerAuth, async () => {
          expect(await tx`select id from agricoop_app.orders where id = ${order.id}`).toEqual([]);
          expect(await tx`
            update agricoop_app.orders set "buyerId" = "buyerId"
            where id = ${order.id}
            returning id
          `).toEqual([]);
        });
        await asAuthenticated(sellerAuth, async () => {
          expect(await tx`select id from agricoop_app.products where id = ${product.id}`).toEqual([]);
          expect(await tx`
            update agricoop_app.products set "priceCents" = "priceCents"
            where id = ${product.id}
            returning id
          `).toEqual([]);
        });

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("enforces product soft-delete ownership, forged deletedBy, and role denies (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const sellerAAuth = "33333333-3333-4333-8333-333333333333";
    const sellerBAuth = "44444444-4444-4444-8444-444444444444";
    const sellerCAuth = "88888888-8888-4888-8888-888888888888";
    const buyerAuth = "55555555-5555-4555-8555-555555555555";
    const adminAuth = "77777777-7777-4777-8777-777777777777";
    const unassignedAdminAuth = "99999999-9999-4999-8999-999999999999";
    const saAuth = "66666666-6666-4666-8666-666666666666";
    const saOtherAuth = "21212121-2121-4212-8212-212121212121";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${sellerAAuth}::uuid, 'harness-seller-a@example.test'),
          (${sellerBAuth}::uuid, 'harness-seller-b@example.test'),
          (${sellerCAuth}::uuid, 'harness-seller-c@example.test'),
          (${buyerAuth}::uuid, 'harness-buyer-sd@example.test'),
          (${adminAuth}::uuid, 'harness-admin-sd@example.test'),
          (${unassignedAdminAuth}::uuid, 'harness-unassigned-admin-sd@example.test'),
          (${saAuth}::uuid, 'harness-sa-sd@example.test'),
          (${saOtherAuth}::uuid, 'harness-sa-other-sd@example.test')
          on conflict (id) do nothing`;

        let [coop] = await tx`
          select id from agricoop_app.cooperatives where "normalizedName" = 'harnesssoftdeletcoop' limit 1
        `;
        if (!coop?.id) {
          [coop] = await tx`
            insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
            values ('Harness SoftDelete Coop', 'harnesssoftdeletcoop', 'Test City', 'Barangay 1', 'testcity', 'active', 'seed')
            returning id
          `;
        }
        expect(coop?.id).toBeTruthy();
        const [otherCoop] = await tx`
          insert into agricoop_app.cooperatives (name, "normalizedName", location, address, "normalizedLocation", status, source)
          values ('Harness SoftDelete Other Coop', 'harnesssoftdeleteothercoop', 'Test City', 'Barangay 2', 'testcity2', 'active', 'seed')
          returning id
        `;

        const upsertUser = async (
          openId: string,
          email: string,
          role: "buyer" | "seller" | "admin" | "superadmin",
          cooperativeId: number | null,
        ) => {
          await tx`
            insert into agricoop_app.users (
              "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId", "lastSignedIn"
            ) values (
              ${openId}, ${email}, ${email}, 'supabase', ${role}::agricoop_app.user_role,
              'approved'::agricoop_app.user_approval_status, ${cooperativeId}, now()
            )
            on conflict ("openId") do update set
              role = excluded.role,
              "approvalStatus" = excluded."approvalStatus",
              "cooperativeId" = excluded."cooperativeId",
              "lastSignedIn" = excluded."lastSignedIn"
          `;
          const [row] = await tx`select id from agricoop_app.users where "openId" = ${openId} limit 1`;
          return row.id as number;
        };

        const sellerAId = await upsertUser(sellerAAuth, "harness-seller-a@example.test", "seller", coop.id);
        const sellerBId = await upsertUser(sellerBAuth, "harness-seller-b@example.test", "seller", coop.id);
        const sellerCId = await upsertUser(sellerCAuth, "harness-seller-c@example.test", "seller", otherCoop.id);
        const buyerId = await upsertUser(buyerAuth, "harness-buyer-sd@example.test", "buyer", null);
        const adminId = await upsertUser(adminAuth, "harness-admin-sd@example.test", "admin", coop.id);
        const unassignedAdminId = await upsertUser(unassignedAdminAuth, "harness-unassigned-admin-sd@example.test", "admin", null);
        const saId = await upsertUser(saAuth, "harness-sa-sd@example.test", "superadmin", null);
        const saOtherId = await upsertUser(saOtherAuth, "harness-sa-other-sd@example.test", "superadmin", null);
        expect(buyerId).toBeTruthy();
        expect(adminId).toBeTruthy();
        expect(unassignedAdminId).toBeTruthy();

        const [productA] = await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values (
            ${sellerAId}, ${coop.id}, 'Harness SoftDelete A', 'Crop', 'Standard', 'test', 'kg',
            100, 10, 1, 'standard', 'published', 'approved', 'visible'
          ) returning id
        `;
        const [productB] = await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values (
            ${sellerBId}, ${coop.id}, 'Harness SoftDelete B', 'Crop', 'Standard', 'test', 'kg',
            100, 10, 1, 'standard', 'published', 'approved', 'visible'
          ) returning id
        `;
        const [productC] = await tx`
          insert into agricoop_app.products (
            "sellerId", "cooperativeId", name, category, variety, description, unit,
            "priceCents", "stockQty", "minOrderQty", "qualityGrade", status, "verificationStatus", visibility
          ) values (
            ${sellerCId}, ${otherCoop.id}, 'Harness SoftDelete C', 'Crop', 'Standard', 'test', 'kg',
            100, 10, 1, 'standard', 'published', 'pending', 'visible'
          ) returning id
        `;

        const asAuth = async (openId: string, fn: () => Promise<void>) => {
          await tx`select set_config('role', 'authenticated', true)`;
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('search_path', 'public, agricoop_app', true)`;
          await tx`select set_config('request.jwt.claim.sub', ${openId}, true)`;
          await tx`select set_config(
            'request.jwt.claims',
            ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: openId })},
            true
          )`;
          await fn();
        };

        await asAuth(sellerAAuth, async () => {
          const ownUpdate = await tx`
            update agricoop_app.products set "priceCents" = 200
            where id = ${productA.id}
            returning id
          `;
          expect(ownUpdate).toHaveLength(1);
          const sameCoopSellerUpdate = await tx`
            update agricoop_app.products set "priceCents" = 300
            where id = ${productB.id}
            returning id
          `;
          expect(sameCoopSellerUpdate).toHaveLength(0);
        });
        await asAuth(buyerAuth, async () => {
          const buyerUpdate = await tx`
            update agricoop_app.products set "priceCents" = 400
            where id = ${productA.id}
            returning id
          `;
          expect(buyerUpdate).toHaveLength(0);
        });
        await asAuth(adminAuth, async () => {
          const moderation = await tx`
            update agricoop_app.products
            set "verificationStatus" = 'rejected', "rejectionReason" = 'Needs review'
            where id = ${productB.id}
            returning id
          `;
          expect(moderation).toHaveLength(1);
          const outOfCoop = await tx`
            update agricoop_app.products set "verificationStatus" = 'approved'
            where id = ${productC.id}
            returning id
          `;
          expect(outOfCoop).toHaveLength(0);
        });
        await asAuth(unassignedAdminAuth, async () => {
          const unscopedModeration = await tx`
            update agricoop_app.products set "verificationStatus" = 'approved'
            where id = ${productA.id}
            returning id
          `;
          expect(unscopedModeration).toHaveLength(0);
        });
        await asAuth(saAuth, async () => {
          const platformModeration = await tx`
            update agricoop_app.products set "verificationStatus" = 'approved'
            where id = ${productC.id}
            returning id
          `;
          expect(platformModeration).toHaveLength(1);
        });

        await asAuth(sellerAAuth, async () => {
          await tx`savepoint seller_self_delete_user`;
          let selfDeleteDenied = false;
          try {
            await tx`
              update agricoop_app.users
              set "deletedAt" = now(), "deletedBy" = ${sellerAId}, "deletedByRole" = 'seller'
              where id = ${sellerAId}
            `;
          } catch (error) {
            selfDeleteDenied = /42501|Only Admin or SuperAdmin|cannot soft-delete/i.test(String(error));
          }
          await tx`rollback to savepoint seller_self_delete_user`;
          expect(selfDeleteDenied).toBe(true);
        });

        // Seller A soft-deletes own listing.
        await asAuth(sellerAAuth, async () => {
          const updated = await tx`
            update agricoop_app.products
            set status = 'archived', visibility = 'hidden', "deletedAt" = now(), "deletedBy" = ${sellerAId}
            where id = ${productA.id} and "sellerId" = ${sellerAId}
            returning id, "deletedBy"
          `;
          expect(updated).toHaveLength(1);
          expect(updated[0].deletedBy).toBe(sellerAId);
        });

        // Seller A cannot forge deletedBy to seller B on own row (BLOCK 27 guard).
        await asAuth(sellerAAuth, async () => {
          await tx`savepoint forge_deleted_by`;
          let forged = false;
          try {
            await tx`
              update agricoop_app.products
              set "deletedBy" = ${sellerBId}
              where id = ${productA.id}
            `;
          } catch (error) {
            forged = /deletedBy must equal|P0001|42501/i.test(String(error));
          }
          await tx`rollback to savepoint forge_deleted_by`;
          expect(forged).toBe(true);
        });

        // Seller A cannot soft-delete seller B's product (RLS).
        await asAuth(sellerAAuth, async () => {
          const touched = await tx`
            update agricoop_app.products
            set status = 'archived', visibility = 'hidden', "deletedAt" = now(), "deletedBy" = ${sellerAId}
            where id = ${productB.id}
            returning id
          `;
          expect(touched).toHaveLength(0);
        });

        // Buyer cannot soft-delete.
        await asAuth(buyerAuth, async () => {
          const touched = await tx`
            update agricoop_app.products
            set status = 'archived', visibility = 'hidden', "deletedAt" = now(), "deletedBy" = ${buyerId}
            where id = ${productB.id}
            returning id
          `;
          expect(touched).toHaveLength(0);
        });

        // Anon cannot UPDATE deletedAt (privilege).
        await tx`select set_config('role', 'anon', true)`;
        await tx.unsafe("set local role anon");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', '', true)`;
        await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
        await tx`savepoint anon_soft_delete`;
        let anonDenied = false;
        try {
          await tx`
            update agricoop_app.products
            set "deletedAt" = now()
            where id = ${productB.id}
          `;
        } catch (error) {
          anonDenied = /permission denied|42501/i.test(String(error));
        }
        await tx`rollback to savepoint anon_soft_delete`;
        expect(anonDenied).toBe(true);

        // Admin sharing cooperative can soft-delete seller B's listing.
        await asAuth(adminAuth, async () => {
          const updated = await tx`
            update agricoop_app.products
            set status = 'archived', visibility = 'hidden', "deletedAt" = now(), "deletedBy" = ${adminId}
            where id = ${productB.id}
            returning id, "deletedBy"
          `;
          expect(updated).toHaveLength(1);
          expect(updated[0].deletedBy).toBe(adminId);

          const softDeletedUser = await tx`
            update agricoop_app.users
            set "deletedAt" = now(), "deletedBy" = ${adminId}, "deletedByRole" = 'admin'
            where id = ${sellerBId}
            returning id
          `;
          expect(softDeletedUser).toHaveLength(1);

          await tx`savepoint admin_self_delete_user`;
          let adminSelfDeleteDenied = false;
          try {
            await tx`
              update agricoop_app.users
              set "deletedAt" = now(), "deletedBy" = ${adminId}, "deletedByRole" = 'admin'
              where id = ${adminId}
            `;
          } catch (error) {
            adminSelfDeleteDenied = /42501|cannot soft-delete or restore themselves/i.test(String(error));
          }
          await tx`rollback to savepoint admin_self_delete_user`;
          expect(adminSelfDeleteDenied).toBe(true);

          const adminDeleteSuperadmin = await tx`
            update agricoop_app.users
            set "deletedAt" = now(), "deletedBy" = ${adminId}, "deletedByRole" = 'admin'
            where id = ${saOtherId}
            returning id
          `;
          expect(adminDeleteSuperadmin).toHaveLength(0);
        });

        await asAuth(sellerBAuth, async () => {
          await tx`savepoint seller_self_restore_user`;
          let selfRestoreDenied = false;
          try {
            await tx`
              update agricoop_app.users
              set "deletedAt" = null, "deletedBy" = null, "deletedByRole" = null
              where id = ${sellerBId}
            `;
          } catch (error) {
            selfRestoreDenied = /42501|Only Admin or SuperAdmin/i.test(String(error));
          }
          await tx`rollback to savepoint seller_self_restore_user`;
          expect(selfRestoreDenied).toBe(true);
        });

        await asAuth(saAuth, async () => {
          await tx`savepoint superadmin_target_delete_user`;
          let superadminTargetDenied = false;
          try {
            await tx`
              update agricoop_app.users
              set "deletedAt" = now(), "deletedBy" = ${saId}, "deletedByRole" = 'superadmin'
              where id = ${saOtherId}
            `;
          } catch (error) {
            superadminTargetDenied = /42501|SuperAdmin account cannot/i.test(String(error));
          }
          await tx`rollback to savepoint superadmin_target_delete_user`;
          expect(superadminTargetDenied).toBe(true);
        });

        // SuperAdmin can soft-delete any listing (restore then delete as SA for proof).
        await asAuth(saAuth, async () => {
          await tx`
            update agricoop_app.products
            set status = 'published', visibility = 'visible', "deletedAt" = null, "deletedBy" = null
            where id = ${productB.id}
          `;
          const updated = await tx`
            update agricoop_app.products
            set status = 'archived', visibility = 'hidden', "deletedAt" = now(), "deletedBy" = ${saId}
            where id = ${productB.id}
            returning id, "deletedBy"
          `;
          expect(updated).toHaveLength(1);
          expect(updated[0].deletedBy).toBe(saId);
        });

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("limits cooperative writes to an Admin's cooperative and keeps SuperAdmin access (rollback)", async () => {
    assertLocalTestDatabaseUrl(testDatabaseUrl);
    const postgres = (await import("postgres")).default;
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const adminAuth = "34343434-3434-4434-8434-343434343434";
    const superAdminAuth = "35353535-3535-4535-8535-353535353535";
    try {
      await sql.begin(async tx => {
        await tx`insert into auth.users (id, email) values
          (${adminAuth}::uuid, 'harness-coop-scope-admin@example.test'),
          (${superAdminAuth}::uuid, 'harness-coop-scope-superadmin@example.test')
          on conflict (id) do nothing`;
        const [assignedCoop] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Coop Scope Assigned', 'harnesscoopscopeassigned',
            'Test City', 'Barangay 8', 'harnesscoopscope8', 'active', 'seed'
          )
          returning id
        `;
        const [otherCoop] = await tx`
          insert into agricoop_app.cooperatives (
            name, "normalizedName", location, address, "normalizedLocation", status, source
          ) values (
            'Harness Coop Scope Other', 'harnesscoopscopeother',
            'Test City', 'Barangay 9', 'harnesscoopscope9', 'active', 'seed'
          )
          returning id
        `;
        await tx`
          insert into agricoop_app.users (
            "openId", name, email, "loginMethod", role, "approvalStatus", "cooperativeId"
          ) values
            (${adminAuth}, 'Harness Scoped Admin', 'harness-coop-scope-admin@example.test', 'supabase', 'admin', 'approved', ${assignedCoop.id}),
            (${superAdminAuth}, 'Harness Scoped SuperAdmin', 'harness-coop-scope-superadmin@example.test', 'supabase', 'superadmin', 'approved', null)
        `;

        await tx`select set_config('role', 'authenticated', true)`;
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('search_path', 'public, agricoop_app', true)`;
        await tx`select set_config('request.jwt.claim.sub', ${adminAuth}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: adminAuth })},
          true
        )`;

        const ownUpdate = await tx`
          update agricoop_app.cooperatives
          set location = 'Admin allowed location'
          where id = ${assignedCoop.id}
          returning id
        `;
        expect(ownUpdate).toHaveLength(1);
        const crossCoopUpdate = await tx`
          update agricoop_app.cooperatives
          set location = 'Admin forbidden location'
          where id = ${otherCoop.id}
          returning id
        `;
        expect(crossCoopUpdate).toEqual([]);

        await tx`select set_config('request.jwt.claim.sub', ${superAdminAuth}, true)`;
        await tx`select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ aud: "authenticated", role: "authenticated", sub: superAdminAuth })},
          true
        )`;
        const superAdminUpdate = await tx`
          update agricoop_app.cooperatives
          set location = 'SuperAdmin allowed location'
          where id = ${otherCoop.id}
          returning id
        `;
        expect(superAdminUpdate).toHaveLength(1);

        throw new Error("harness_rollback");
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || error.message !== "harness_rollback") throw error;
      });
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
