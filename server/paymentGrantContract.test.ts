import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const grantMigration = readFileSync(fileURLToPath(
  new URL("../supabase/migrations/20261117211000_payment_fulfillment_column_grants.sql", import.meta.url),
), "utf8");

const writeGrantMigration = readFileSync(fileURLToPath(
  new URL("../supabase/migrations/20261117220000_write_grants_and_profile_role_sync.sql", import.meta.url),
), "utf8");

const systemPaymentMigration = readFileSync(fileURLToPath(
  new URL("../supabase/migrations/20261118022138_system_payment_admin_only.sql", import.meta.url),
), "utf8");

describe("BLOCK 15 payment/fulfillment column grants", () => {
  it("uses column-scoped GRANT statements (not table-wide SELECT)", () => {
    expect(grantMigration).toMatch(
      /GRANT SELECT \("allowsPickup", "allowsDelivery", "acceptsOnlinePayment"\)\s+ON TABLE agricoop_app\.products TO anon, authenticated;/s,
    );
    expect(grantMigration).toMatch(
      /GRANT SELECT \(\s*"onlinePaymentQrPath",\s*"onlinePaymentAccountName",\s*"onlinePaymentAccountNumber",\s*"onlinePaymentLabel"\s*\) ON TABLE agricoop_app\.users TO authenticated;/s,
    );
    expect(grantMigration).toMatch(
      /GRANT UPDATE \(\s*"onlinePaymentQrPath",\s*"onlinePaymentAccountName",\s*"onlinePaymentAccountNumber",\s*"onlinePaymentLabel"\s*\) ON TABLE agricoop_app\.users TO authenticated;/s,
    );
    expect(grantMigration).toContain(
      'GRANT SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users TO anon;',
    );
    expect(grantMigration).toContain(
      'GRANT SELECT ("fulfillmentMethod") ON TABLE agricoop_app.orders TO authenticated;',
    );

    // Must remain column-scoped: no blanket table GRANT SELECT for these secrets.
    expect(grantMigration).not.toMatch(/GRANT SELECT ON TABLE agricoop_app\.users TO anon/);
    expect(grantMigration).not.toMatch(/GRANT SELECT ON TABLE agricoop_app\.users TO authenticated/);
    expect(grantMigration).not.toContain('GRANT SELECT ("onlinePaymentAccountName") ON TABLE agricoop_app.users TO anon');
    expect(grantMigration).not.toContain('GRANT SELECT ("onlinePaymentAccountNumber") ON TABLE agricoop_app.users TO anon');
  });

  it("documents postflight privilege checks for CI", () => {
    expect(grantMigration).toContain("has_column_privilege('anon', 'agricoop_app.products', 'allowsPickup', 'SELECT')");
    expect(grantMigration).toContain("has_column_privilege('authenticated', 'agricoop_app.users', 'onlinePaymentAccountName', 'SELECT')");
    // Negative check: anon must NOT have account-name SELECT (fails postflight if privilege is true).
    expect(grantMigration).toContain("OR has_column_privilege('anon', 'agricoop_app.users', 'onlinePaymentAccountName', 'SELECT')");
  });
});

describe("BLOCK 16 write grants and profile role sync", () => {
  it("grants INSERT/UPDATE on listing payment flags and serial defaults", () => {
    expect(writeGrantMigration).toMatch(
      /GRANT INSERT \(\s*"id",\s*"createdAt",\s*"allowsPickup",\s*"allowsDelivery",\s*"acceptsOnlinePayment"\s*\)\s+ON TABLE agricoop_app\.products TO authenticated;/s,
    );
    expect(writeGrantMigration).toMatch(
      /GRANT UPDATE \(\s*"allowsPickup",\s*"allowsDelivery",\s*"acceptsOnlinePayment"\s*\)\s+ON TABLE agricoop_app\.products TO authenticated;/s,
    );
    expect(writeGrantMigration).toContain('GRANT INSERT ("id", "createdAt", "updatedAt") ON TABLE agricoop_app."paymentOptions" TO authenticated;');
    expect(writeGrantMigration).toContain('GRANT INSERT ("id", "createdAt") ON TABLE agricoop_app."productImages" TO authenticated;');
  });

  it("ships SECURITY DEFINER sync_profile_role_from_app for officers", () => {
    expect(writeGrantMigration).toContain("CREATE OR REPLACE FUNCTION agricoop_app.sync_profile_role_from_app");
    expect(writeGrantMigration).toContain("SECURITY DEFINER");
    expect(writeGrantMigration).toContain("GRANT EXECUTE ON FUNCTION agricoop_app.sync_profile_role_from_app(text, text) TO authenticated;");
  });
});

describe("BLOCK 17 system payment is admin-only", () => {
  it("adds system payment tables and revokes seller QR grants without dropping columns", () => {
    expect(systemPaymentMigration).toContain('CREATE TABLE IF NOT EXISTS agricoop_app."systemPaymentSettings"');
    expect(systemPaymentMigration).toContain('CREATE TABLE IF NOT EXISTS agricoop_app."systemOnlinePaymentAccounts"');
    expect(systemPaymentMigration).toContain('CREATE TABLE IF NOT EXISTS agricoop_app."systemPaymentSettingsAudit"');
    expect(systemPaymentMigration).toContain("'system-payment-qr'");
    expect(systemPaymentMigration).toContain('REVOKE SELECT ("onlinePaymentQrPath") ON TABLE agricoop_app.users FROM anon;');
    expect(systemPaymentMigration).toContain("DROP POLICY IF EXISTS seller_payment_qr_owner_insert ON storage.objects;");
    expect(systemPaymentMigration).not.toMatch(/DROP COLUMN/i);
  });
});
