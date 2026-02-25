import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

function getEnv(names: string[]): string | null {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }

  return null;
}

export function createUserClient(authHeader: string): SupabaseClient {
  const url = getEnv(["SUPABASE_URL", "ST_SUPABASE_URL"]);
  const anonKey = getEnv(["SUPABASE_ANON_KEY", "ST_SUPABASE_ANON_KEY"]);

  if (!url) throw new Error("Missing SUPABASE_URL/ST_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY/ST_SUPABASE_ANON_KEY");

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
}

export function createServiceClient(): SupabaseClient {
  const url = getEnv(["SUPABASE_URL", "ST_SUPABASE_URL"]);
  const serviceRoleKey = getEnv(["SUPABASE_SERVICE_ROLE_KEY", "ST_SERVICE_ROLE_KEY"]);

  if (!url) throw new Error("Missing SUPABASE_URL/ST_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY/ST_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
