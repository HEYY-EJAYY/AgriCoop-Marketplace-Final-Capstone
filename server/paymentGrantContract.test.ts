import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const grantMigration = readFileSync(fileURLToPath(
  new URL("../supabase/migrations/20261117211000_payment_fulfillment_column_grants.sql", import.meta.url),
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
