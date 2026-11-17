import { logAuthDiagnostic } from "@/lib/authSession";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const goToAuth = (component = "unspecified") => {
  logAuthDiagnostic("navigation_to_auth", { component, destination: "/auth" });
  window.location.href = "/auth";
};
