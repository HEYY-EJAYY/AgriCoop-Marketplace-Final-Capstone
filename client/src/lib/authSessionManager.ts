export type BrowserSession = { access_token: string } | null;

export type AuthSessionSource = {
  getSession: () => Promise<{ session: BrowserSession; errorPresent: boolean }>;
  onAuthStateChange: (callback: (event: string, session: BrowserSession) => void) => () => void;
};

export type AuthSessionSnapshot = {
  initialized: boolean;
  accessTokenPresent: boolean;
};

export type AuthSessionDiagnostic = {
  event: "session_initialized" | "session_initialization_failed" | "auth_state_change" | "login_session_received";
  sessionPresent: boolean;
  accessTokenPresent: boolean;
  authEvent?: string;
  errorPresent?: boolean;
};

export function createAuthSessionManager(
  source: AuthSessionSource | null,
  diagnose: (event: AuthSessionDiagnostic) => void = () => undefined,
) {
  let accessToken: string | null = null;
  let sessionVersion = 0;
  let snapshot: AuthSessionSnapshot = { initialized: source === null, accessTokenPresent: false };
  const subscribers = new Set<() => void>();
  let resolveInitialization!: () => void;
  const initialization = new Promise<void>(resolve => {
    resolveInitialization = resolve;
  });

  const publish = () => {
    snapshot = { initialized: snapshot.initialized, accessTokenPresent: Boolean(accessToken) };
    subscribers.forEach(subscriber => subscriber());
  };
  const finishInitialization = () => {
    snapshot = { initialized: true, accessTokenPresent: Boolean(accessToken) };
    resolveInitialization();
    subscribers.forEach(subscriber => subscriber());
  };
  const setSession = (event: AuthSessionDiagnostic["event"], session: BrowserSession, authEvent?: string) => {
    sessionVersion += 1;
    accessToken = session?.access_token ?? null;
    publish();
    diagnose({
      event,
      sessionPresent: Boolean(session),
      accessTokenPresent: Boolean(accessToken),
      ...(authEvent ? { authEvent } : {}),
    });
  };

  if (source) {
    source.onAuthStateChange((event, session) => setSession("auth_state_change", session, event));
    const initialVersion = sessionVersion;
    void source.getSession().then(({ session, errorPresent }) => {
      if (sessionVersion === initialVersion) {
        accessToken = session?.access_token ?? null;
      }
      finishInitialization();
      diagnose({
        event: "session_initialized",
        sessionPresent: Boolean(session),
        accessTokenPresent: Boolean(accessToken),
        errorPresent,
      });
    }).catch(() => {
      finishInitialization();
      diagnose({
        event: "session_initialization_failed",
        sessionPresent: false,
        accessTokenPresent: Boolean(accessToken),
        errorPresent: true,
      });
    });
  } else {
    resolveInitialization();
  }

  return {
    waitUntilInitialized: () => initialization,
    getAccessToken: () => snapshot.initialized ? accessToken : null,
    getSnapshot: () => snapshot,
    subscribe: (subscriber: () => void) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    setLoginSession: (session: BrowserSession) => setSession("login_session_received", session),
  };
}

export function shouldRedirectToAuth(state: {
  sessionInitialized: boolean;
  authLoading: boolean;
  userPresent: boolean;
  unauthenticated: boolean;
}) {
  return state.sessionInitialized && !state.authLoading && !state.userPresent && state.unauthenticated;
}
