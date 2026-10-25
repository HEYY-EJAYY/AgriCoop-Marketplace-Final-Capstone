import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";
import { isSupabaseConfigured, supabase } from "./supabase";

export const trpc = createTRPCReact<AppRouter>();

type SessionReader = () => Promise<{
  data: { session: { access_token?: string } | null };
  error: unknown;
}>;

const readCurrentSession: SessionReader = () => supabase.auth.getSession();

/**
 * Resolve the current browser session at request time. Reading the token once
 * during module initialization races the first auth.me query after a reload or
 * sign-in, which previously sent an anonymous request and redirected users
 * back to /auth.
 */
export async function getSupabaseAuthHeaders(
  readSession: SessionReader = readCurrentSession
): Promise<Record<string, string>> {
  if (!isSupabaseConfigured && readSession === readCurrentSession) return {};
  const { data, error } = await readSession();
  const accessToken = error ? null : (data.session?.access_token ?? null);
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
