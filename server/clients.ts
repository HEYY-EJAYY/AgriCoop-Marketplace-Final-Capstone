import { createClient } from "@supabase/supabase-js";
import { readSupabaseConfig } from "./supabaseConfig.js";

const { url: supabaseUrl, anonKey: supabaseKey, serviceRoleKey: supabaseServiceKey } = readSupabaseConfig(process.env);

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, clientOptions);
export const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey, clientOptions) : supabase;
