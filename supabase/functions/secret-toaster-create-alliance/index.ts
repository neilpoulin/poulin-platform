import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type CreateAllianceBody = {
  gameId?: string;
  name?: string;
  colorHex?: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeColorHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: CreateAllianceBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const gameId = asText(body.gameId).trim();
  const name = asText(body.name).trim();
  const colorHex = normalizeColorHex(body.colorHex);

  if (!gameId) return badRequest("gameId is required");
  if (name.length < 2 || name.length > 40) return badRequest("name must be 2..40 characters");
  if (body.colorHex && !colorHex) return badRequest("colorHex must be #RRGGBB");

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

    const { data: inserted, error: insertErr } = await service
      .schema("secret_toaster")
      .from("game_alliances")
      .insert({
        game_id: gameId,
        name,
        color_hex: colorHex,
        created_by: userId,
      })
      .select("id, name, color_hex, created_at")
      .single();

    if (insertErr || !inserted) {
      if (insertErr?.code === "23505") return badRequest("Alliance name is already used in this game");
      return serverError("Failed to create alliance");
    }

    const { error: membershipUpsertErr } = await service
      .schema("secret_toaster")
      .from("game_player_alliances")
      .upsert(
        {
          game_id: gameId,
          user_id: userId,
          alliance_id: inserted.id,
        },
        { onConflict: "game_id,user_id" },
      );

    if (membershipUpsertErr) return serverError("Failed to set alliance membership");

    return json(200, {
      ok: true,
      allianceId: inserted.id,
      name: inserted.name,
      colorHex: inserted.color_hex,
      createdAt: inserted.created_at,
    });
  } catch (error) {
    console.error("secret-toaster-create-alliance error", error);
    return serverError();
  }
});
