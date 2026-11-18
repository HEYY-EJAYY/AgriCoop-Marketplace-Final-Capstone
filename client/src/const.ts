import { logAuthDiagnostic } from "@/lib/authSession";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const goToAuth = (component = "unspecified", options?: { register?: boolean }) => {
  const destination = options?.register ? "/auth?register=1" : "/auth";
  logAuthDiagnostic("navigation_to_auth", { component, destination });
  window.location.href = destination;
};
