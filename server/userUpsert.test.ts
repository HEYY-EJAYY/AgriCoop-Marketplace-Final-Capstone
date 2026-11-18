import { describe, expect, it } from "vitest";
import type { InsertUser } from "../drizzle/pg-schema";
import { buildUserUpsertPlan } from "./db";

const userInput = (overrides: Partial<InsertUser> = {}): InsertUser => ({
  openId: "auth-user-id",
  name: "Example User",
  email: "user@example.test",
  loginMethod: "supabase",
  role: "buyer",
  approvalStatus: "approved",
  cooperativeId: null,
  ...overrides,
});

describe("user registration upsert plan", () => {
  it("inserts a Buyer with the trusted approved status", () => {
    const plan = buildUserUpsertPlan(userInput());
    expect(plan.values).toMatchObject({
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: null,
      requestedRole: null,
    });
  });

  it("inserts a Seller with the trusted pending status and optional cooperative", () => {
    const plan = buildUserUpsertPlan(userInput({
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: 12,
    }), { intent: "seller" });
    expect(plan.values).toMatchObject({
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: 12,
      requestedRole: null,
    });
  });

  it("inserts Cooperative Admin applicants as buyers with requestedRole admin", () => {
    const plan = buildUserUpsertPlan(userInput({
      role: "buyer",
      approvalStatus: "approved",
      requestedRole: "admin",
    }), { intent: "cooperative_admin" });
    expect(plan.values).toMatchObject({
      role: "buyer",
      approvalStatus: "approved",
      requestedRole: "admin",
      cooperativeId: null,
    });
    expect(plan.identity.registrationChoice).toBe("coop_admin");
  });

  it("does not rewrite an existing account role, approval status, or cooperative", () => {
    const plan = buildUserUpsertPlan(userInput());
    expect(plan.updateSet).not.toHaveProperty("role");
    expect(plan.updateSet).not.toHaveProperty("approvalStatus");
    expect(plan.updateSet).not.toHaveProperty("cooperativeId");
  });

  it("uses the trusted default when no cooperative assignment is supplied", () => {
    const plan = buildUserUpsertPlan(userInput({ cooperativeId: undefined }));
    expect(plan.values.cooperativeId).toBeNull();
  });

  it.each([
    ["admin", "approved", null],
    ["superadmin", "approved", null],
    ["seller", "approved", null],
    ["buyer", "pending", null],
  ] as const)("rejects an untrusted registration assignment (%s, %s, %s)", (role, approvalStatus, cooperativeId) => {
    expect(() => buildUserUpsertPlan(userInput({
      role,
      approvalStatus,
      cooperativeId,
    }))).toThrow(/verified public registration identity/i);
  });

  it("allows buyer cooperativeId at signup on INSERT", () => {
    const plan = buildUserUpsertPlan(userInput({
      role: "buyer",
      approvalStatus: "approved",
      cooperativeId: 9,
    }));
    expect(plan.values.cooperativeId).toBe(9);
  });

  it("rejects cooperativeId on Cooperative Admin user upsert", () => {
    expect(() => buildUserUpsertPlan(userInput({
      role: "buyer",
      approvalStatus: "approved",
      requestedRole: "admin",
      cooperativeId: 9,
    }), { intent: "cooperative_admin" })).toThrow(/must not set users\.cooperativeId/i);
  });
});
