import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { notifyApprovedOfficers } from "./routers";

const dialect = new PgDialect();

type OfficerRow = {
  id: number;
  role: string;
  cooperativeId: number | null;
  approvalStatus: string;
  deletedAt: Date | null;
};

function createDb(officers: OfficerRow[]) {
  const notifiedUserIds: number[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(officers),
      }),
    }),
    execute: async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      if (rendered.sql.includes("create_notification")) {
        notifiedUserIds.push(rendered.params[0] as number);
      }
      return [];
    },
  };
  return { db, notifiedUserIds };
}

const input = {
  title: "Cash order awaiting confirmation",
  content: "Order #1 is awaiting payment confirmation.",
  link: "/orders/1",
  relatedEntityId: 1,
};

describe("notifyApprovedOfficers recipient scoping", () => {
  it("notifies an approved active OfficerAdmin in the order's cooperative", async () => {
    const { db, notifiedUserIds } = createDb([
      { id: 10, role: "admin", cooperativeId: 3, approvalStatus: "approved", deletedAt: null },
    ]);
    await notifyApprovedOfficers(db as never, input, 3);
    expect(notifiedUserIds).toEqual([10]);
  });

  it("does not notify an OfficerAdmin assigned to another cooperative", async () => {
    const { db, notifiedUserIds } = createDb([
      { id: 10, role: "admin", cooperativeId: 3, approvalStatus: "approved", deletedAt: null },
      { id: 11, role: "admin", cooperativeId: 99, approvalStatus: "approved", deletedAt: null },
    ]);
    await notifyApprovedOfficers(db as never, input, 3);
    expect(notifiedUserIds).toEqual([10]);
  });

  it("notifies an active SuperAdmin globally", async () => {
    const { db, notifiedUserIds } = createDb([
      { id: 20, role: "superadmin", cooperativeId: null, approvalStatus: "approved", deletedAt: null },
      { id: 21, role: "superadmin", cooperativeId: 99, approvalStatus: "approved", deletedAt: null },
    ]);
    await notifyApprovedOfficers(db as never, input, 3);
    expect(notifiedUserIds).toEqual([20, 21]);
  });

  it("excludes soft-deleted OfficerAdmin and SuperAdmin accounts", async () => {
    const { db, notifiedUserIds } = createDb([
      { id: 10, role: "admin", cooperativeId: 3, approvalStatus: "approved", deletedAt: new Date() },
      { id: 20, role: "superadmin", cooperativeId: null, approvalStatus: "approved", deletedAt: new Date() },
    ]);
    await notifyApprovedOfficers(db as never, input, 3);
    expect(notifiedUserIds).toEqual([]);
  });

  it("excludes non-approved officer accounts", async () => {
    const { db, notifiedUserIds } = createDb([
      { id: 10, role: "admin", cooperativeId: 3, approvalStatus: "pending", deletedAt: null },
      { id: 20, role: "superadmin", cooperativeId: null, approvalStatus: "suspended", deletedAt: null },
    ]);
    await notifyApprovedOfficers(db as never, input, 3);
    expect(notifiedUserIds).toEqual([]);
  });

  it("skips cooperative-scoped OfficerAdmins when the order has no cooperative", async () => {
    const { db, notifiedUserIds } = createDb([
      { id: 10, role: "admin", cooperativeId: 3, approvalStatus: "approved", deletedAt: null },
      { id: 20, role: "superadmin", cooperativeId: null, approvalStatus: "approved", deletedAt: null },
    ]);
    await notifyApprovedOfficers(db as never, input, null);
    expect(notifiedUserIds).toEqual([20]);
  });
});
