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
    });
  });

  it("inserts a Seller with the trusted pending status", () => {
    const plan = buildUserUpsertPlan(userInput({
      role: "seller",
      approvalStatus: "pending",
    }));
    expect(plan.values).toMatchObject({
      role: "seller",
      approvalStatus: "pending",
      cooperativeId: null,
    });
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
    ["seller", "pending", 12],
  ] as const)("rejects an untrusted registration assignment (%s, %s, %s)", (role, approvalStatus, cooperativeId) => {
    expect(() => buildUserUpsertPlan(userInput({
      role,
      approvalStatus,
      cooperativeId,
    }))).toThrow("verified Buyer or Seller");
  });
});
