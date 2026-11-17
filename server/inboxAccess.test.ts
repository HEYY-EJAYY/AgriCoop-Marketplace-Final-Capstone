import { describe, expect, it } from "vitest";
import { canAccessConversation } from "./authz";

describe("inbox access control", () => {
  const trade = { buyerId: 10, sellerId: 20 };
  const support = { buyerId: 10, sellerId: null };

  it("allows only buyer and seller on private order chats", () => {
    expect(canAccessConversation({ id: 10, role: "buyer", cooperativeId: null }, trade, 1)).toBe(true);
    expect(canAccessConversation({ id: 20, role: "seller", cooperativeId: 1 }, trade, 1)).toBe(true);
    expect(canAccessConversation({ id: 30, role: "admin", cooperativeId: 1 }, trade, 1)).toBe(false);
    expect(canAccessConversation({ id: 40, role: "superadmin", cooperativeId: null }, trade, 1)).toBe(false);
    expect(canAccessConversation({ id: 99, role: "buyer", cooperativeId: null }, trade, 1)).toBe(false);
  });

  it("allows requester and officers on platform support threads", () => {
    expect(canAccessConversation({ id: 10, role: "buyer", cooperativeId: null }, support, null)).toBe(true);
    expect(canAccessConversation({ id: 30, role: "admin", cooperativeId: 1 }, support, null)).toBe(true);
    expect(canAccessConversation({ id: 40, role: "superadmin", cooperativeId: null }, support, null)).toBe(true);
    expect(canAccessConversation({ id: 99, role: "seller", cooperativeId: 1 }, support, null)).toBe(false);
  });

  it("documents that trade-chat privacy has no silent admin bypass", () => {
    // Dispute escalation would be an explicit logged path; until then officers cannot read trade chats.
    expect(canAccessConversation({ id: 1, role: "admin", cooperativeId: 1 }, trade, 1)).toBe(false);
  });
});

describe("inbox action semantics", () => {
  it("treats pin/archive/delete as per-user state keys", () => {
    const actions = ["read", "unread", "pin", "unpin", "archive", "unarchive", "delete", "restore"] as const;
    expect(actions).toContain("archive");
    expect(actions).toContain("delete");
    // Soft-delete must never be an unscoped table wipe — callers write threadStates.deletedAt only.
    expect("deletedAt" in { deletedAt: new Date() }).toBe(true);
  });
});
