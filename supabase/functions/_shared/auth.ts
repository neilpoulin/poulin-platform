import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function getAuthedUserId(userClient: SupabaseClient): Promise<string | null> {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
