import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { cooperativeAssociationRequests, orders, paymentOptions, paymentProofs, payments, productImages, products, profileVerificationSubmissions, profiles, roles, supportTicketMessages, transactions, users } from "../drizzle/pg-schema";

describe("PostgreSQL identity lookup schema", () => {
  it("uses only the user-confirmed production enum labels for marketplace payment/order fields", () => {
    expect(users.role.enumValues).toEqual(["buyer", "seller", "admin", "superadmin"]);
    expect(users.approvalStatus.enumValues).toEqual(["approved", "pending", "suspended"]);
    expect(orders.status.enumValues).toEqual([
      "submitted", "confirmed", "ready", "completed", "cancelled",
      "processing", "shipped", "delivered",
    ]);
    expect(orders.paymentStatus.enumValues).toEqual([
      "pending", "paid", "failed", "F2F-pending-confirmation",
      "awaiting_verification", "verified", "refunded", "expired",
    ]);
    expect(transactions.status.enumValues).toEqual([
      "recorded", "payment_coordinated", "pending", "paid", "failed",
    ]);
    expect(products.verificationStatus.enumValues).toEqual([
      "draft", "pending", "approved", "rejected", "pending_review",
    ]);
  });

  it("uses the confirmed identity and canonical role columns", () => {
    expect(getTableConfig(users).columns.map(column => column.name)).toEqual([
      "id", "openId", "name", "email", "loginMethod", "role", "requestedRole", "approvalStatus",
      "verificationStatus", "verificationNote", "verifiedBy", "verifiedAt",
      "profileImageUrl", "birthdate", "phone", "address", "cooperativeId",
      "contactNumber", "onlinePaymentQrPath", "onlinePaymentAccountName",
      "onlinePaymentAccountNumber", "onlinePaymentLabel",
      "createdAt", "updatedAt", "lastSignedIn",
    ]);
    expect(getTableConfig(profiles).columns.map(column => column.name)).toEqual([
      "user_id", "full_name", "email", "role_id", "cooperative_id", "account_status", "created_at",
    ]);
    expect(getTableConfig(roles).columns.map(column => column.name)).toEqual(["role_id", "role_name"]);
  });

  it("keeps the auth migration role-ID independent and aligned with confirmed user enums", () => {
    const migration = readFileSync(fileURLToPath(
      new URL("../supabase/migrations/20261117100000_auth_profile_access.sql", import.meta.url),
    ), "utf8");

    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I)");
    expect(migration).toContain('GRANT SELECT ("id", "openId", "name", "email", "role", "approvalStatus", "verificationStatus"');
    expect(migration).toContain("has_table_privilege('authenticated', 'agricoop_app.users', 'SELECT')");
    expect(migration).toContain("has_table_privilege('authenticated', 'agricoop_app.users', 'UPDATE')");
    expect(migration).toContain("has_column_privilege('authenticated', 'agricoop_app.users', 'role', 'UPDATE')");
    expect(migration).toContain("has_column_privilege('authenticated', 'agricoop_app.users', 'cooperativeId', 'UPDATE')");
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+agricoop_app\.users\s+TO\s+authenticated/i);
    expect(migration).not.toMatch(/\brole_id\s*=\s*\d+/i);
    expect(migration).not.toMatch(/\brole_id\s+IN\s*\(\s*\d/i);
    expect(migration).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
    expect(migration).toContain("agricoop_app.user_role");
    expect(migration).toContain("agricoop_app.user_approval_status");
    expect(migration).toContain("r.role_name IN ('buyer', 'seller')");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated");
  });

  it("queries agricoop_app.users.openId directly using the verified Auth UUID", () => {
    const authUserId = "36100037-c7fe-4152-b7b6-1f9d91ebf35c";
    const query = new PgDialect().sqlToQuery(sql`
      select ${users.id}, ${users.openId}, ${users.approvalStatus}, ${users.cooperativeId}
      from ${users}
      where ${eq(users.openId, authUserId)}
      limit 2
    `);

    expect(query.sql).toContain('"agricoop_app"."users"');
    expect(query.sql).toContain('"openId"');
    expect(query.sql).toContain('"approvalStatus"');
    expect(query.sql).toContain('"cooperativeId"');
    expect(query.sql).toContain("limit 2");
    expect(query.sql).not.toContain('"public"."profiles"');
    expect(query.sql).not.toContain("`");
    expect(query.params).toContain(authUserId);
  });

  it("loads the public role mapping independently after finding the application user", () => {
    const query = new PgDialect().sqlToQuery(sql`
      select ${roles.roleName}
      from ${profiles}
      left join ${roles} on ${eq(profiles.roleId, roles.roleId)}
      where ${eq(profiles.userId, "36100037-c7fe-4152-b7b6-1f9d91ebf35c")}
      limit 2
    `);

    expect(query.sql).toContain('"profiles"');
    expect(query.sql).toContain('"roles"');
    expect(query.sql).toContain('"role_id"');
    expect(query.params).toContain("36100037-c7fe-4152-b7b6-1f9d91ebf35c");
  });

  it("persists the selected checkout option through the existing order transaction", () => {
    const query = new PgDialect().sqlToQuery(sql`
      select ${transactions.paymentOptionId}
      from ${transactions}
      join ${paymentOptions} on ${eq(transactions.paymentOptionId, paymentOptions.id)}
    `);

    expect(query.sql).toContain('"agricoop_app"."transactions"."paymentOptionId"');
    expect(query.sql).toContain('"agricoop_app"."paymentOptions"');
    expect(query.sql).not.toContain("`");

    const config = getTableConfig(transactions);
    expect(config.indexes.map(index => ({
      name: index.config.name,
      unique: index.config.unique,
      columns: index.config.columns.map(column => column.name),
    }))).toContainEqual({
      name: "transactions_order_id_idx",
      unique: true,
      columns: ["orderId"],
    });
  });

  it("matches the confirmed paymentOptions columns, PostgreSQL types, and indexes", () => {
    const config = getTableConfig(paymentOptions);
    expect(config.name).toBe("paymentOptions");
    expect(config.schema).toBe("agricoop_app");
    expect(config.columns.map(column => column.name)).toEqual([
      "id", "cooperativeId", "paymentMethod", "displayName", "accountName",
      "accountNumber", "qrImagePath", "instructions", "isActive", "createdBy",
      "createdAt", "updatedAt",
    ]);
    expect(config.columns.find(column => column.name === "isActive")?.columnType).toBe("PgBoolean");
    expect(config.columns.find(column => column.name === "paymentMethod")?.length).toBe(50);
    expect(config.columns.find(column => column.name === "displayName")?.length).toBe(150);
    expect(config.columns.find(column => column.name === "id")?.hasDefault).toBe(true);
    expect(config.columns.find(column => column.name === "cooperativeId")?.notNull).toBe(false);
    expect(config.columns.find(column => column.name === "paymentMethod")?.default).toBe("gcash");
    expect(config.columns.find(column => column.name === "isActive")?.default).toBe(true);
    expect(config.columns.find(column => column.name === "createdAt")?.notNull).toBe(true);
    expect(config.columns.find(column => column.name === "updatedAt")?.notNull).toBe(true);
    expect(config.indexes.map(index => index.config.name)).toEqual([
      "paymentOptionsCooperativeIdIdx",
      "paymentOptionsIsActiveIdx",
    ]);
    expect(config.foreignKeys.map(foreignKey => {
      const reference = foreignKey.reference();
      return {
        column: reference.columns[0].name,
        table: getTableConfig(reference.foreignTable).name,
        referencedColumn: reference.foreignColumns[0].name,
        onDelete: foreignKey.onDelete,
      };
    })).toEqual([
      { column: "cooperativeId", table: "cooperatives", referencedColumn: "id", onDelete: "restrict" },
      { column: "createdBy", table: "users", referencedColumn: "id", onDelete: "set null" },
    ]);
  });

  it("matches the confirmed paymentProofs columns, types, checks, and indexes", () => {
    const config = getTableConfig(paymentProofs);
    expect(config.name).toBe("paymentProofs");
    expect(config.schema).toBe("agricoop_app");
    expect(config.columns.map(column => column.name)).toEqual([
      "id", "orderId", "transactionId", "uploadedBy", "storagePath",
      "originalFileName", "mimeType", "fileSizeBytes", "verificationStatus",
      "reviewNote", "reviewedBy", "reviewedAt", "createdAt", "updatedAt",
    ]);
    expect(config.columns.find(column => column.name === "id")?.hasDefault).toBe(false);
    expect(config.columns.find(column => column.name === "fileSizeBytes")?.columnType).toBe("PgBigInt53");
    expect(config.columns.find(column => column.name === "fileSizeBytes")?.notNull).toBe(false);
    expect(config.columns.find(column => column.name === "orderId")?.notNull).toBe(true);
    expect(config.columns.find(column => column.name === "transactionId")?.notNull).toBe(false);
    expect(config.columns.find(column => column.name === "verificationStatus")?.default).toBe("pending");
    expect(config.columns.find(column => column.name === "createdAt")?.notNull).toBe(true);
    expect(config.checks.map(check => check.name)).toEqual([
      "paymentProofsVerificationStatusCheck",
      "paymentProofsFileSizeBytesCheck",
      "paymentProofsMimeTypeCheck",
    ]);
    expect(config.indexes.map(index => index.config.name)).toEqual([
      "paymentProofsOrderIdIdx",
      "paymentProofsUploadedByIdx",
      "paymentProofsVerificationStatusIdx",
    ]);
    expect(config.foreignKeys.map(foreignKey => {
      const reference = foreignKey.reference();
      return {
        column: reference.columns[0].name,
        table: getTableConfig(reference.foreignTable).name,
        referencedColumn: reference.foreignColumns[0].name,
        onDelete: foreignKey.onDelete,
      };
    })).toEqual([
      { column: "orderId", table: "orders", referencedColumn: "id", onDelete: "restrict" },
      { column: "transactionId", table: "transactions", referencedColumn: "id", onDelete: "set null" },
      { column: "uploadedBy", table: "users", referencedColumn: "id", onDelete: "restrict" },
      { column: "reviewedBy", table: "users", referencedColumn: "id", onDelete: "set null" },
    ]);
  });

  it("models private profile-verification history with pending-submission uniqueness", () => {
    const config = getTableConfig(profileVerificationSubmissions);
    expect(config.name).toBe("profileVerificationSubmissions");
    expect(config.schema).toBe("agricoop_app");
    expect(config.columns.map(column => column.name)).toEqual([
      "id", "userId", "storagePath", "mimeType", "fileSizeBytes",
      "submissionNote", "status", "submittedAt", "reviewedBy", "reviewedAt", "reviewNote",
    ]);
    expect(profileVerificationSubmissions.status.enumValues).toEqual([
      "unverified", "pending", "approved", "rejected",
    ]);
    expect(config.columns.find(column => column.name === "fileSizeBytes")?.columnType).toBe("PgBigInt53");
    expect(config.columns.find(column => column.name === "submittedAt")?.hasDefault).toBe(true);
    expect(config.indexes.map(index => index.config.name)).toEqual([
      "profileVerificationSubmissionsUserSubmittedIdx",
      "profileVerificationSubmissionsOnePendingUserIdx",
    ]);
    expect(config.indexes.find(index => index.config.name === "profileVerificationSubmissionsOnePendingUserIdx")?.config.unique).toBe(true);
    expect(config.foreignKeys.map(foreignKey => foreignKey.reference().foreignTable)).toContain(users);
  });

  it("keeps the verification SQL draft additive and avoids unrestricted policies or numeric role assumptions", () => {
    const migration = readFileSync(fileURLToPath(
      new URL("../supabase/migrations/20261117120000_profile_verification_submissions.sql", import.meta.url),
    ), "utf8");

    expect(migration).toContain(`to_regclass('agricoop_app."profileVerificationSubmissions"')`);
    expect(migration).toContain('pg_get_serial_sequence(target_table, \'id\')');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION agricoop_app.write_profile_verification_audit_event()");
    expect(migration).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, agricoop_app, auth/);
    expect(migration).toContain('AFTER INSERT OR UPDATE OF "status"');
    expect(migration).toContain("has_any_column_privilege('authenticated', 'agricoop_app.\"auditLogs\"', 'INSERT')");
    expect(migration).not.toContain('CREATE POLICY agricoop_profile_verification_audit_insert');
    expect(migration).not.toMatch(/GRANT\s+INSERT\s+ON\s+TABLE\s+agricoop_app\."auditLogs"/i);
    expect(migration).toContain("guard_profile_verification_user_update");
    expect(migration).toContain("current_setting('agricoop.profile_verification_upload_verified', true) = '1'");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE agricoop_app.\"profileVerificationSubmissions\"");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain('NEW."birthdate" IS DISTINCT FROM OLD."birthdate"');
    expect(migration).toContain('personal_details_changed AND actor_id IS DISTINCT FROM OLD."id"');
    expect(migration).toContain('"verifiedAt", "birthdate", "phone", "address"');
    expect(migration).not.toContain("profileVerificationSubmissions_id_seq");
    expect(migration).not.toMatch(/\bGRANT\s+ALL\b/i);
    expect(migration).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/\brole\s*=\s*\d+/i);
  });

  it("keeps the separate Storage bucket setup private and limited to verification images", () => {
    const setup = readFileSync(fileURLToPath(
      new URL("../supabase/storage/profile_verification_bucket.sql", import.meta.url),
    ), "utf8");

    expect(setup).toContain("'profile-verification-documents'");
    expect(setup).toContain("public IS FALSE");
    expect(setup).toContain("file_size_limit = 5242880");
    expect(setup).toContain("ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]");
    expect(setup).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(setup).not.toMatch(/\bGRANT\s+ALL\b/i);
  });

  it("uses the qualified product gallery table and preserves mixed-case column names", () => {
    const query = new PgDialect().sqlToQuery(sql`
      select ${productImages.productId}, ${productImages.imageUrl}, ${productImages.displayOrder}
      from ${productImages}
    `);

    expect(query.sql).toContain('"agricoop_app"."productImages"');
    expect(query.sql).toContain('"productId"');
    expect(query.sql).toContain('"imageUrl"');
    expect(query.sql).not.toContain("`");
  });

  it("uses the qualified cooperative association table and mixed-case identity columns", () => {
    const query = new PgDialect().sqlToQuery(sql`
      select ${cooperativeAssociationRequests.sellerId}, ${cooperativeAssociationRequests.cooperativeId}
      from ${cooperativeAssociationRequests}
    `);

    expect(query.sql).toContain('"agricoop_app"."cooperativeAssociationRequests"');
    expect(query.sql).toContain('"sellerId"');
    expect(query.sql).toContain('"cooperativeId"');
    expect(query.sql).not.toContain("`");
  });

  it("uses the qualified support ticket message table and mixed-case columns", () => {
    const query = new PgDialect().sqlToQuery(sql`
      select ${supportTicketMessages.ticketId}, ${supportTicketMessages.senderId}
      from ${supportTicketMessages}
    `);

    expect(query.sql).toContain('"agricoop_app"."supportTicketMessages"');
    expect(query.sql).toContain('"ticketId"');
    expect(query.sql).toContain('"senderId"');
    expect(query.sql).not.toContain("`");
  });
});
