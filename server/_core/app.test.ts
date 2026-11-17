import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES, MAX_PRODUCT_IMAGE_SIZE_BYTES } from "../../shared/productOptions";

vi.mock("../health", () => ({
  getHealthStatus: vi.fn().mockResolvedValue({ status: "ok", database: "available" }),
}));

describe("Vercel Express app routes", () => {
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close(error => error ? reject(error) : resolve());
    });
    server = undefined;
  });

  const startApp = () => {
    const app = createApp({ restoreVercelFunctionPath: true });
    app.post("/__test/large-body", (req, res) => res.status(204).end());
    server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP listener.");
    return `http://127.0.0.1:${address.port}`;
  };

  it("routes rewritten conversation stream and health requests through the Vercel app", async () => {
    const baseUrl = startApp();
    const streamResponse = await fetch(`${baseUrl}/api/index?__vercel_path=conversations/1/stream`);
    const healthResponse = await fetch(`${baseUrl}/api/index?__vercel_path=health`);

    expect(streamResponse.status).toBe(401);
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("does not mount the legacy storage proxy in the Vercel app", async () => {
    const baseUrl = startApp();
    const directResponse = await fetch(`${baseUrl}/manus-storage/products/7/harvest.png`, {
      headers: { Authorization: "Bearer untrusted-token" },
    });
    const rewrittenResponse = await fetch(`${baseUrl}/api/index?__vercel_path=manus-storage/products/7/harvest.png`, {
      headers: { Authorization: "Bearer untrusted-token" },
    });

    expect(directResponse.status).toBe(404);
    expect(rewrittenResponse.status).toBe(404);
  });

  it("accepts a maximum image upload payload within the Vercel function request limit", async () => {
    const baseUrl = startApp();
    const base64Length = Math.ceil(MAX_PRODUCT_IMAGE_SIZE_BYTES / 3) * 4;
    const body = JSON.stringify({ image: "x".repeat(base64Length) });
    expect(Buffer.byteLength(body)).toBeLessThan(MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES);
    const response = await fetch(`${baseUrl}/__test/large-body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(204);
  });

  it("rejects JSON bodies above the configured Vercel-safe request limit", async () => {
    const baseUrl = startApp();
    const response = await fetch(`${baseUrl}/__test/large-body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "x".repeat(MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES) }),
    });

    expect(response.status).toBe(413);
  });
});
