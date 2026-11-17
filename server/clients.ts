import { createClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./supabaseConfig";

const { url: supabaseUrl, anonKey: supabaseKey, serviceRoleKey: supabaseServiceKey } = readSupabaseConfig(process.env);

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
};

export function createPublicAuthClient() {
  return createClient(supabaseUrl, supabaseKey, clientOptions);
}

export const supabase = createPublicAuthClient();
export const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey, clientOptions) : supabase;
