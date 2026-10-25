import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./supabaseConfig.js";
import type { SupabaseDatabase } from "./supabaseTypes.js";

const {
  url: supabaseUrl,
  anonKey: supabaseKey,
  serviceRoleKey: supabaseServiceKey,
} = readSupabaseConfig(process.env);

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
};

export const supabase = createClient<SupabaseDatabase>(
  supabaseUrl,
  supabaseKey,
  clientOptions
);
export const hasSupabaseServiceRole = Boolean(supabaseServiceKey);
export const supabaseAdmin: SupabaseClient<SupabaseDatabase> =
  hasSupabaseServiceRole
    ? createClient<SupabaseDatabase>(
        supabaseUrl,
        supabaseServiceKey,
        clientOptions
      )
    : supabase;

/**
 * Create a request-scoped client when a caller must be evaluated under the
 * caller's RLS policies. The server normally uses the service-role client for
 * profile/commerce reads, but this helper keeps authentication safe when a
 * local development environment intentionally omits that key.
 */
export function createSupabaseRequestClient(accessToken: string) {
  return createClient<SupabaseDatabase>(supabaseUrl, supabaseKey, {
    ...clientOptions,
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
