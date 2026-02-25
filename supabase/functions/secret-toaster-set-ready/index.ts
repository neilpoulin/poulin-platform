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
  executedCommandCount: number;
  appliedMoveCount: number;
};

type CommandEventRow = {
  id: number;
  caused_by: string | null;
  payload: Record<string, unknown>;
};

type GameStateHex = {
  ownerUserId: string;
  troopCount: number;
  knightCount: number;
};

type GameState = {
  round: number;
  hexes: Record<string, GameStateHex>;
  players?: Record<string, unknown>;
};

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createDeterministicRandom(seedInput: string): () => number {
  let state = hashSeed(seedInput) || 1;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildDeterministicExecutionOrder(input: {
  commands: CommandEventRow[];
  gameId: string;
  round: number;
}): CommandEventRow[] {
  const { commands, gameId, round } = input;
  if (commands.length <= 1) return [...commands];

  const commandsByPlayer = new Map<string, CommandEventRow[]>();
  for (const command of commands) {
    const playerId = command.caused_by;
    if (!playerId) continue;

    const queue = commandsByPlayer.get(playerId);
    if (queue) {
      queue.push(command);
    } else {
      commandsByPlayer.set(playerId, [command]);
    }
  }

  const playerOrder = [...commandsByPlayer.keys()].sort();
  if (playerOrder.length === 0) return [];

  const random = createDeterministicRandom(`${gameId}:${round}:${commands.length}`);
  const executionOrder: CommandEventRow[] = [];

  while (true) {
    const activePlayers = playerOrder.filter((playerId) => {
      const queue = commandsByPlayer.get(playerId);
      return Boolean(queue && queue.length > 0);
    });

    if (activePlayers.length === 0) break;

    const playerIndex = Math.floor(random() * activePlayers.length);
    const selectedPlayer = activePlayers[playerIndex];
    const queue = commandsByPlayer.get(selectedPlayer);
    const nextCommand = queue?.shift();
    if (nextCommand) executionOrder.push(nextCommand);
  }

  return executionOrder;
}

function extractCommandPayload(command: CommandEventRow): {
  commandType: string;
  payload: Record<string, unknown>;
} {
  const rawCommandType = command.payload.commandType;
  const commandType = typeof rawCommandType === "string" && rawCommandType.trim().length > 0
    ? rawCommandType
    : "unknown";

  const rawPayload = command.payload.payload;
  const payload =
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? (rawPayload as Record<string, unknown>)
      : {};

  return { commandType, payload };
}

function asInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  return value;
}

function ensureHex(state: GameState, hexId: number): GameStateHex {
  const key = String(hexId);
  const existing = state.hexes[key];
  if (existing) return existing;

  const created: GameStateHex = {
    ownerUserId: "",
    troopCount: 0,
    knightCount: 0,
  };
  state.hexes[key] = created;
  return created;
}

function parseGameState(rawState: unknown, round: number): GameState {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
    return {
      round,
      hexes: {},
    };
  }

  const record = rawState as Record<string, unknown>;
  const rawHexes = record.hexes;
  const parsedHexes: Record<string, GameStateHex> = {};

  if (rawHexes && typeof rawHexes === "object" && !Array.isArray(rawHexes)) {
    for (const [key, value] of Object.entries(rawHexes as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const hex = value as Record<string, unknown>;
      parsedHexes[key] = {
        ownerUserId: typeof hex.ownerUserId === "string" ? hex.ownerUserId : "",
        troopCount: asInt(hex.troopCount) ?? 0,
        knightCount: asInt(hex.knightCount) ?? 0,
      };
    }
  }

  const stateRound = asInt(record.round) ?? round;

  return {
    round: stateRound,
    hexes: parsedHexes,
    players: record.players && typeof record.players === "object" && !Array.isArray(record.players)
      ? (record.players as Record<string, unknown>)
      : undefined,
  };
}

function applyOrderSubmitMove(state: GameState, command: CommandEventRow): { applied: boolean; movedTroops: number } {
  const actorUserId = command.caused_by;
  if (!actorUserId) return { applied: false, movedTroops: 0 };

  const extracted = extractCommandPayload(command);
  if (extracted.commandType !== "order.submit") return { applied: false, movedTroops: 0 };

  const fromHexId = asInt(extracted.payload.fromHexId);
  const toHexId = asInt(extracted.payload.toHexId);
  const troopCount = asInt(extracted.payload.troopCount);
  if (fromHexId === null || toHexId === null || troopCount === null) return { applied: false, movedTroops: 0 };

  const fromHex = ensureHex(state, fromHexId);
  const toHex = ensureHex(state, toHexId);
  if (fromHex.ownerUserId !== actorUserId) return { applied: false, movedTroops: 0 };

  const availableTroops = Math.max(0, fromHex.troopCount);
  if (availableTroops <= 0) return { applied: false, movedTroops: 0 };

  const movedTroops = troopCount > 0 ? Math.min(troopCount, availableTroops) : 0;

  if (movedTroops <= 0) return { applied: false, movedTroops: 0 };

  fromHex.troopCount = Math.max(0, fromHex.troopCount - movedTroops);
  toHex.ownerUserId = actorUserId;
  toHex.troopCount = Math.max(0, toHex.troopCount) + movedTroops;

  return {
    applied: true,
    movedTroops,
  };
}

function normalizeQueuedCommands(commands: CommandEventRow[]): CommandEventRow[] {
  const groupedByPlayer = new Map<string, CommandEventRow[]>();

  for (const command of commands) {
    if (!command.caused_by) continue;
    const queue = groupedByPlayer.get(command.caused_by);
    if (queue) {
      queue.push(command);
    } else {
      groupedByPlayer.set(command.caused_by, [command]);
    }
  }

  const normalized: CommandEventRow[] = [];

  for (const [, playerCommands] of groupedByPlayer) {
    const orderedCommands = [...playerCommands].sort((left, right) => left.id - right.id);
    const orderSlots = new Map<number, CommandEventRow>();
    const passthrough: CommandEventRow[] = [];

    for (const command of orderedCommands) {
      const parsed = extractCommandPayload(command);

      if (parsed.commandType === "order.submit") {
        const orderNumber = asInt(parsed.payload.orderNumber);
        if (orderNumber && orderNumber >= 1 && orderNumber <= 3) {
          orderSlots.set(orderNumber, command);
          for (let nextOrder = orderNumber + 1; nextOrder <= 3; nextOrder += 1) {
            orderSlots.delete(nextOrder);
          }
          continue;
        }
      }

      passthrough.push(command);
    }

    for (const orderNumber of [1, 2, 3]) {
      const slotted = orderSlots.get(orderNumber);
      if (slotted) normalized.push(slotted);
    }

    normalized.push(...passthrough);
  }

  return normalized.sort((left, right) => left.id - right.id);
}

async function advanceRoundIfAllReady(input: {
  service: ReturnType<typeof createServiceClient>;
  gameId: string;
  actorUserId: string;
  round: number;
  currentState: unknown;
  readyCount: number;
  activePlayerCount: number;
}): Promise<RoundAdvanceResult> {
  const { service, gameId, actorUserId, round, currentState, readyCount, activePlayerCount } = input;

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
      executedCommandCount: 0,
      appliedMoveCount: 0,
    };
  }

  const toRound = updatedGame.round;

  const { data: commandEvents, error: commandEventsErr } = await service
    .schema("secret_toaster")
    .from("game_events")
    .select("id, caused_by, payload")
    .eq("game_id", gameId)
    .eq("event_type", "command.received")
    .eq("payload->>round", String(round))
    .order("id", { ascending: true });

  if (commandEventsErr) {
    throw new Error(`Failed to load pending commands: ${commandEventsErr.message}`);
  }

  const normalizedCommandEvents = normalizeQueuedCommands((commandEvents ?? []) as CommandEventRow[]);

  const nextState = parseGameState(currentState, round);
  let appliedMoveCount = 0;

  const executionOrder = buildDeterministicExecutionOrder({
    commands: normalizedCommandEvents,
    gameId,
    round,
  });

  const commandExecutionEvents = executionOrder.map((commandEvent, index) => {
    const command = extractCommandPayload(commandEvent);
    const orderNumber = asInt(command.payload.orderNumber);
    const moveResult = applyOrderSubmitMove(nextState, commandEvent);
    if (moveResult.applied) appliedMoveCount += 1;

    return {
      game_id: gameId,
      event_type: "command.executed",
      payload: {
        round,
        executionIndex: index,
        sourceEventId: commandEvent.id,
        playerUserId: commandEvent.caused_by,
        commandType: command.commandType,
        payload: command.payload,
        orderNumber,
        applied: moveResult.applied,
        movedTroops: moveResult.movedTroops,
      },
      caused_by: commandEvent.caused_by,
    };
  });

  nextState.round = toRound;

  const { error: stateUpdateErr } = await service
    .schema("secret_toaster")
    .from("games")
    .update({ current_state: nextState })
    .eq("id", gameId);

  if (stateUpdateErr) {
    throw new Error(`Failed to persist current_state: ${stateUpdateErr.message}`);
  }

  if (commandExecutionEvents.length > 0) {
    const { error: commandExecutionErr } = await service
      .schema("secret_toaster")
      .from("game_events")
      .insert(commandExecutionEvents);

    if (commandExecutionErr) {
      throw new Error(`Failed to append command execution events: ${commandExecutionErr.message}`);
    }
  }

  const [{ error: allReadyEventErr }, { error: advancedEventErr }] = await Promise.all([
    service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "round.ready_all",
      payload: {
        round,
        readyCount,
        activePlayerCount,
        commandCount: executionOrder.length,
        appliedMoveCount,
      },
      caused_by: actorUserId,
    }),
    service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "round.executed",
      payload: {
        fromRound: round,
        toRound,
        strategy: "deterministic-v1",
        commandCount: executionOrder.length,
        appliedMoveCount,
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
    executedCommandCount: executionOrder.length,
    appliedMoveCount,
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
      .select("round, current_state")
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
          currentState: game.current_state,
          readyCount: safeReadyCount,
          activePlayerCount: safeActivePlayerCount,
        })
      : {
          advanced: false,
          fromRound: round,
          toRound: round,
          executedCommandCount: 0,
          appliedMoveCount: 0,
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
      executedCommandCount: roundAdvance.executedCommandCount,
      appliedMoveCount: roundAdvance.appliedMoveCount,
    });
  } catch (error) {
    console.error("secret-toaster-set-ready error", error);
    return serverError();
  }
});
