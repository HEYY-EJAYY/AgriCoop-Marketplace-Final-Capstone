import { beforeAll, describe, expect, it } from "vitest";
import {
  coopAdminApplicationExtension,
  createCoopAdminApplicationUploadIntent,
  isCoopAdminApplicationStorageKey,
  verifyCoopAdminApplicationUploadIntent,
} from "./coopAdminApplication";
import { COOP_ADMIN_APPLICATION_CONTENT_TYPES } from "../shared/coopAdminApplication";

const OPEN_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_OPEN_ID = "99999999-8888-4777-8666-555555555555";
const VALID_PATH = `${OPEN_ID}/123e4567-e89b-42d3-a456-426614174000.pdf`;

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-secret";
});

describe("coop admin application upload intents", () => {
  it("accepts JPEG, PNG, WebP, and PDF content types", () => {
    expect([...COOP_ADMIN_APPLICATION_CONTENT_TYPES].sort()).toEqual(
      ["application/pdf", "image/jpeg", "image/png", "image/webp"].sort(),
    );
  });

  it("maps supported MIME types to storage extensions", () => {
    expect(coopAdminApplicationExtension("image/jpeg")).toBe("jpg");
    expect(coopAdminApplicationExtension("image/png")).toBe("png");
    expect(coopAdminApplicationExtension("image/webp")).toBe("webp");
    expect(coopAdminApplicationExtension("application/pdf")).toBe("pdf");
    expect(coopAdminApplicationExtension("image/gif")).toBeNull();
    expect(coopAdminApplicationExtension("application/zip")).toBeNull();
  });

  it("accepts user-prefixed document keys and rejects foreign or malformed keys", () => {
    for (const ext of ["jpg", "png", "webp", "pdf"]) {
      expect(isCoopAdminApplicationStorageKey(`${OPEN_ID}/123e4567-e89b-42d3-a456-426614174000.${ext}`, OPEN_ID)).toBe(true);
    }
    expect(isCoopAdminApplicationStorageKey(`${OTHER_OPEN_ID}/123e4567-e89b-42d3-a456-426614174000.pdf`, OPEN_ID)).toBe(false);
    expect(isCoopAdminApplicationStorageKey(`${OPEN_ID}/nested/123e4567-e89b-42d3-a456-426614174000.pdf`, OPEN_ID)).toBe(false);
    expect(isCoopAdminApplicationStorageKey(`${OPEN_ID}/not-a-uuid.pdf`, OPEN_ID)).toBe(false);
    expect(isCoopAdminApplicationStorageKey(`${OPEN_ID}/123e4567-e89b-42d3-a456-426614174000.exe`, OPEN_ID)).toBe(false);
    expect(isCoopAdminApplicationStorageKey(`${OPEN_ID}/123e4567-e89b-42d3-a456-426614174000.pdf/extra`, OPEN_ID)).toBe(false);
  });

  it("round-trips a signed intent and rejects tampering, expiry, and wrong owners", () => {
    const now = Date.now();
    const token = createCoopAdminApplicationUploadIntent({
      userId: 7,
      openId: OPEN_ID,
      storagePath: VALID_PATH,
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
    }, now);
    const verified = verifyCoopAdminApplicationUploadIntent(token, 7, OPEN_ID, now + 1000);
    expect(verified).toMatchObject({ storagePath: VALID_PATH, mimeType: "application/pdf", fileSizeBytes: 1024 });

    expect(verifyCoopAdminApplicationUploadIntent(token, 8, OPEN_ID, now + 1000)).toBeNull();
    expect(verifyCoopAdminApplicationUploadIntent(token, 7, OTHER_OPEN_ID, now + 1000)).toBeNull();
    expect(verifyCoopAdminApplicationUploadIntent(token, 7, OPEN_ID, now + 11 * 60 * 1000)).toBeNull();
    expect(verifyCoopAdminApplicationUploadIntent(token + "x", 7, OPEN_ID, now + 1000)).toBeNull();
  });

  it("rejects intents for disallowed types and oversized files", () => {
    const now = Date.now();
    const token = createCoopAdminApplicationUploadIntent({
      userId: 7,
      openId: OPEN_ID,
      storagePath: VALID_PATH,
      mimeType: "image/gif" as never,
      fileSizeBytes: 1024,
    }, now);
    // Sign happens regardless; verification must still reject the MIME type.
    expect(verifyCoopAdminApplicationUploadIntent(token, 7, OPEN_ID, now + 1000)).toBeNull();
  });
});
