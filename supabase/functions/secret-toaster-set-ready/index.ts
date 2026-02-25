import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type SetReadyBody = {
  gameId?: string;
  isReady?: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: SetReadyBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const isReady = typeof body.isReady === "boolean" ? body.isReady : null;

  if (!gameId) return badRequest("gameId is required");
  if (isReady === null) return badRequest("isReady is required");

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

    if (membershipErr) return serverError("Failed to verify membership");
    if (!membership) return forbidden("Not an active member of this game");

    const { data: game, error: gameErr } = await service
      .schema("secret_toaster")
      .from("games")
      .select("round")
      .eq("id", gameId)
      .single();

    if (gameErr || !game) return serverError("Failed to load game");

    const round = game.round;

    const { error: readyErr } = await service.schema("secret_toaster").from("player_readiness").upsert(
      {
        game_id: gameId,
        round,
        user_id: userId,
        is_ready: isReady,
      },
      { onConflict: "game_id,round,user_id" },
    );

    if (readyErr) return serverError("Failed to persist readiness");

    const [{ count: activePlayerCount, error: activeCountErr }, { count: readyCount, error: readyCountErr }] =
      await Promise.all([
        service
          .schema("secret_toaster")
          .from("game_memberships")
          .select("id", { count: "exact", head: true })
          .eq("game_id", gameId)
          .eq("is_active", true),
        service
          .schema("secret_toaster")
          .from("player_readiness")
          .select("id", { count: "exact", head: true })
          .eq("game_id", gameId)
          .eq("round", round)
          .eq("is_ready", true),
      ]);

    if (activeCountErr || readyCountErr) return serverError("Failed to calculate readiness status");

    const safeActivePlayerCount = activePlayerCount ?? 0;
    const safeReadyCount = readyCount ?? 0;
    const allReady = safeActivePlayerCount > 0 && safeReadyCount >= safeActivePlayerCount;

    const { error: readyEventErr } = await service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "player.ready_changed",
      payload: {
        userId,
        round,
        isReady,
        readyCount: safeReadyCount,
        activePlayerCount: safeActivePlayerCount,
      },
      caused_by: userId,
    });

    if (readyEventErr) return serverError("Failed to append readiness event");

    if (allReady) {
      const { error: allReadyEventErr } = await service.schema("secret_toaster").from("game_events").insert({
        game_id: gameId,
        event_type: "round.ready_all",
        payload: {
          round,
          readyCount: safeReadyCount,
          activePlayerCount: safeActivePlayerCount,
        },
        caused_by: userId,
      });

      if (allReadyEventErr) return serverError("Failed to append ready_all event");
    }

    return json(200, {
      ok: true,
      gameId,
      round,
      isReady,
      readyCount: safeReadyCount,
      activePlayerCount: safeActivePlayerCount,
      allReady,
    });
  } catch (error) {
    console.error("secret-toaster-set-ready error", error);
    return serverError();
  }
});
