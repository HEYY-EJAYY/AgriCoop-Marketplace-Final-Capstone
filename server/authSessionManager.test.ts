import { describe, expect, it } from "vitest";
import { createAuthSessionManager, shouldRedirectToAuth, type BrowserSession } from "../client/src/lib/authSessionManager";

describe("browser authentication session initialization", () => {
  it("waits for session initialization before a protected tRPC request can access the token", async () => {
    let resolveSession!: (result: { session: BrowserSession; errorPresent: boolean }) => void;
    const initialSession = new Promise<{ session: BrowserSession; errorPresent: boolean }>(resolve => {
      resolveSession = resolve;
    });
    const manager = createAuthSessionManager({
      getSession: () => initialSession,
      onAuthStateChange: () => () => undefined,
    });
    let requestReady = false;
    const protectedRequest = manager.waitUntilInitialized().then(() => {
      requestReady = true;
      return manager.getAccessToken();
    });

    await Promise.resolve();
    expect(requestReady).toBe(false);
    expect(manager.getAccessToken()).toBeNull();

    resolveSession({ session: { access_token: "test-token" }, errorPresent: false });
    await expect(protectedRequest).resolves.toBe("test-token");
    expect(manager.getSnapshot()).toEqual({ initialized: true, accessTokenPresent: true });
  });

  it("does not let a stale initial session overwrite a newer auth event", async () => {
    let resolveSession!: (result: { session: BrowserSession; errorPresent: boolean }) => void;
    let onAuthStateChange!: (event: string, session: BrowserSession) => void;
    const initialSession = new Promise<{ session: BrowserSession; errorPresent: boolean }>(resolve => {
      resolveSession = resolve;
    });
    const manager = createAuthSessionManager({
      getSession: () => initialSession,
      onAuthStateChange: callback => {
        onAuthStateChange = callback;
        return () => undefined;
      },
    });

    onAuthStateChange("SIGNED_IN", { access_token: "new-token" });
    resolveSession({ session: null, errorPresent: false });
    await manager.waitUntilInitialized();

    expect(manager.getAccessToken()).toBe("new-token");
  });

  it("does not redirect while authentication or the user query is loading", () => {
    expect(shouldRedirectToAuth({
      sessionInitialized: false,
      authLoading: true,
      userPresent: false,
      unauthenticated: true,
    })).toBe(false);
    expect(shouldRedirectToAuth({
      sessionInitialized: true,
      authLoading: true,
      userPresent: false,
      unauthenticated: true,
    })).toBe(false);
    expect(shouldRedirectToAuth({
      sessionInitialized: true,
      authLoading: false,
      userPresent: false,
      unauthenticated: true,
    })).toBe(true);
  });
});
