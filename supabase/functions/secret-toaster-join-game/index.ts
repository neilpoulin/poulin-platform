import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { passwordMatches } from "../_shared/password.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type JoinByInvite = { inviteToken: string };
type JoinByCode = { gameCode: string; password: string };
type JoinBody = JoinByInvite | JoinByCode;

function isJoinByInvite(body: JoinBody): body is JoinByInvite {
  return "inviteToken" in body;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: JoinBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const userClient = createUserClient(authHeader);
  const service = createServiceClient();

  const userId = await getAuthedUserId(userClient);
  if (!userId) return unauthorized();

  try {
    let gameId: string | null = null;
    let gameCode: string | null = null;

    if (isJoinByInvite(body)) {
      const token = body.inviteToken?.trim();
      if (!token) return badRequest("inviteToken is required");

      const { data: invite, error: inviteError } = await service
        .schema("secret_toaster")
        .from("game_invites")
        .select("id, game_id, used_at, revoked_at, expires_at")
        .eq("token", token)
        .single();

      if (inviteError || !invite) return forbidden("Invalid invite token");
      if (invite.revoked_at) return forbidden("Invite revoked");
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
        return forbidden("Invite expired");
      }

      gameId = invite.game_id;

      const { data: gameFromInvite, error: inviteGameErr } = await service
        .schema("secret_toaster")
        .from("games")
        .select("game_code")
        .eq("id", gameId)
        .maybeSingle();

      if (inviteGameErr || !gameFromInvite) return serverError("Unable to resolve game from invite");
      gameCode = gameFromInvite.game_code;

      const { error: usedErr } = await service
        .schema("secret_toaster")
        .from("game_invites")
        .update({ used_at: new Date().toISOString() })
        .eq("id", invite.id)
        .is("used_at", null);

      if (usedErr) return serverError("Failed to track invite usage");
    } else {
      const gameCode = normalizeCode(body.gameCode || "");
      const password = body.password || "";
      if (!gameCode || !password) return badRequest("gameCode and password are required");

      const { data: game, error: gameErr } = await service
        .schema("secret_toaster")
        .from("games")
        .select("id, game_code, join_password_hash")
        .eq("game_code", gameCode)
        .single();

      if (gameErr || !game) return forbidden("Invalid game code or password");

      const ok = await passwordMatches(game.join_password_hash, password);
      if (!ok) return forbidden("Invalid game code or password");

      gameId = game.id;
      gameCode = game.game_code;
    }

    if (!gameId) return serverError("No game resolved");

    const { error: membershipErr } = await service.schema("secret_toaster").from("game_memberships").upsert({
      game_id: gameId,
      user_id: userId,
      role: "player",
      is_active: true,
      left_at: null,
    }, { onConflict: "game_id,user_id" });

    if (membershipErr) return serverError("Failed to add membership");

    const { error: eventErr } = await service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "player.joined",
      payload: { userId },
      caused_by: userId,
    });

    if (eventErr) return serverError("Failed to append join event");

    return json(200, { ok: true, gameId, gameCode });
  } catch (error) {
    console.error("secret-toaster-join-game error", error);
    return serverError();
  }
});
