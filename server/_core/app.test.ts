import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("Vercel Express adapter", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(createApp({ restoreVercelFunctionPath: true }));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to bind the test server."));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  it("restores rewritten tRPC paths and applies security headers", async () => {
    const input = encodeURIComponent(JSON.stringify({ json: null }));
    const response = await fetch(`${baseUrl}/api/index?__vercel_path=trpc/auth.me&input=${input}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: { json: null } } });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("serves the browser's direct /api/trpc URL for unauthenticated auth.me", async () => {
    const input = encodeURIComponent(JSON.stringify({ json: null }));
    const response = await fetch(`${baseUrl}/api/trpc/auth.me?input=${input}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: { json: null } } });
  });

  it("does not confuse the SPA fallback with the API route", async () => {
    const response = await fetch(`${baseUrl}/api/trpc/auth.me`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { data: { json: null } } });
  });
});
