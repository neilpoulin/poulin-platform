import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type SetAllianceBody = {
  gameId?: string;
  allianceId?: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: SetAllianceBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const gameId = asText(body.gameId).trim();
  const allianceId = body.allianceId === null ? null : asText(body.allianceId).trim() || null;

  if (!gameId) return badRequest("gameId is required");

  const userClient = createUserClient(authHeader);
  const service = createServiceClient();

  const userId = await getAuthedUserId(userClient);
  if (!userId) return unauthorized();

  try {
    const { data: membership, error: membershipErr } = await service
      .schema("secret_toaster")
      .from("game_memberships")
      .select("id")
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipErr) return serverError("Failed to verify game membership");
    if (!membership) return forbidden("Not a member of this game");

    if (allianceId) {
      const { data: alliance, error: allianceErr } = await service
        .schema("secret_toaster")
        .from("game_alliances")
        .select("id")
        .eq("id", allianceId)
        .eq("game_id", gameId)
        .maybeSingle();

      if (allianceErr) return serverError("Failed to verify alliance");
      if (!alliance) return badRequest("Alliance does not exist in this game");
    }

    const { error: upsertErr } = await service
      .schema("secret_toaster")
      .from("game_player_alliances")
      .upsert(
        {
          game_id: gameId,
          user_id: userId,
          alliance_id: allianceId,
        },
        { onConflict: "game_id,user_id" },
      );

    if (upsertErr) return serverError("Failed to update alliance membership");

    return json(200, {
      ok: true,
      gameId,
      allianceId,
    });
  } catch (error) {
    console.error("secret-toaster-set-alliance error", error);
    return serverError();
  }
});
