import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type SetReadyBody = {
  gameId?: string;
  isReady?: boolean;
};

type RoundAdvanceResult = {
  advanced: boolean;
  fromRound: number;
  toRound: number;
};

async function advanceRoundIfAllReady(input: {
  service: ReturnType<typeof createServiceClient>;
  gameId: string;
  actorUserId: string;
  round: number;
  readyCount: number;
  activePlayerCount: number;
}): Promise<RoundAdvanceResult> {
  const { service, gameId, actorUserId, round, readyCount, activePlayerCount } = input;

  const { data: updatedGame, error: updateErr } = await service
    .schema("secret_toaster")
    .from("games")
    .update({ round: round + 1 })
    .eq("id", gameId)
    .eq("round", round)
    .select("round")
    .maybeSingle();

  if (updateErr) {
    throw new Error(`Failed to advance round: ${updateErr.message}`);
  }

  if (!updatedGame) {
    return {
      advanced: false,
      fromRound: round,
      toRound: round,
    };
  }

  const toRound = updatedGame.round;

  const [{ error: allReadyEventErr }, { error: advancedEventErr }] = await Promise.all([
    service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "round.ready_all",
      payload: {
        round,
        readyCount,
        activePlayerCount,
      },
      caused_by: actorUserId,
    }),
    service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "round.executed",
      payload: {
        fromRound: round,
        toRound,
        strategy: "all-ready-auto-advance",
      },
      caused_by: actorUserId,
    }),
  ]);

  if (allReadyEventErr) {
    throw new Error(`Failed to append ready_all event: ${allReadyEventErr.message}`);
  }

  if (advancedEventErr) {
    throw new Error(`Failed to append round.executed event: ${advancedEventErr.message}`);
  }

  return {
    advanced: true,
    fromRound: round,
    toRound,
  };
}

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

    const roundAdvance = allReady
      ? await advanceRoundIfAllReady({
          service,
          gameId,
          actorUserId: userId,
          round,
          readyCount: safeReadyCount,
          activePlayerCount: safeActivePlayerCount,
        })
      : {
          advanced: false,
          fromRound: round,
          toRound: round,
        };

    return json(200, {
      ok: true,
      gameId,
      round: roundAdvance.toRound,
      isReady,
      readyCount: safeReadyCount,
      activePlayerCount: safeActivePlayerCount,
      allReady,
      roundAdvanced: roundAdvance.advanced,
      fromRound: roundAdvance.fromRound,
      toRound: roundAdvance.toRound,
    });
  } catch (error) {
    console.error("secret-toaster-set-ready error", error);
    return serverError();
  }
});
