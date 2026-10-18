import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "local-anon-key";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, clientOptions);
export const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey, clientOptions) : supabase;
