/** Hard safety guard for local DB harness — localhost only. */
export function assertLocalTestDatabaseUrl(rawUrl: string | undefined, envName = "TEST_DATABASE_URL") {
  if (!rawUrl) {
    throw new Error(`${envName} is required for the local DB harness.`);
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${envName} must be a valid URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${envName} must use the postgres/postgresql protocol.`);
  }
  const host = url.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`${envName} refused: host must be localhost/127.0.0.1/::1 (got ${host}).`);
  }
  return url;
}
