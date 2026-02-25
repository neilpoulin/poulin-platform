import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type CommandBody = {
  gameId: string;
  commandType: string;
  payload?: Record<string, unknown>;
};

type OrderSubmitPayload = {
  orderNumber: number;
  fromHexId: number;
  toHexId: number;
  actionType: "move" | "attack" | "fortify" | "promote";
  troopCount?: number;
};

type GameRoundRow = {
  round: number;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  return value;
}

function validateCommandPayload(commandType: string, payload: unknown): {
  valid: boolean;
  reason?: string;
  normalizedPayload?: Record<string, unknown>;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      valid: false,
      reason: "payload must be an object",
    };
  }

  const recordPayload = payload as Record<string, unknown>;

  if (commandType !== "order.submit") {
    return {
      valid: true,
      normalizedPayload: recordPayload,
    };
  }

  const orderNumber = asInt(recordPayload.orderNumber);
  const fromHexId = asInt(recordPayload.fromHexId);
  const toHexId = asInt(recordPayload.toHexId);
  const actionType = asText(recordPayload.actionType).trim() || "move";
  const troopCount = asInt(recordPayload.troopCount);

  if (orderNumber === null || orderNumber < 1 || orderNumber > 3) {
    return {
      valid: false,
      reason: "order.submit requires integer orderNumber in range 1..3",
    };
  }

  if (fromHexId === null || fromHexId < 0 || fromHexId > 109) {
    return {
      valid: false,
      reason: "order.submit requires integer fromHexId in range 0..109",
    };
  }

  if (toHexId === null || toHexId < 0 || toHexId > 109) {
    return {
      valid: false,
      reason: "order.submit requires integer toHexId in range 0..109",
    };
  }

  const normalizedActionType =
    actionType === "move" || actionType === "attack" || actionType === "fortify" || actionType === "promote"
      ? actionType
      : null;

  if (!normalizedActionType) {
    return {
      valid: false,
      reason: "order.submit actionType must be one of move|attack|fortify|promote",
    };
  }

  if ((normalizedActionType === "fortify" || normalizedActionType === "promote") && fromHexId !== toHexId) {
    return {
      valid: false,
      reason: `${normalizedActionType} requires fromHexId and toHexId to match`,
    };
  }

  if (normalizedActionType === "move" || normalizedActionType === "attack") {
    if (troopCount === null || troopCount < 1) {
      return {
        valid: false,
        reason: `order.submit ${normalizedActionType} requires integer troopCount >= 1`,
      };
    }
  }

  const normalizedOrderPayload: OrderSubmitPayload = {
    orderNumber,
    fromHexId,
    toHexId,
    actionType: normalizedActionType,
    troopCount: normalizedActionType === "move" || normalizedActionType === "attack" ? troopCount ?? undefined : undefined,
  };

  return {
    valid: true,
    normalizedPayload: normalizedOrderPayload,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: CommandBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const gameId = asText(body.gameId).trim();
  const commandType = asText(body.commandType).trim();
  const payload = body.payload ?? {};

  if (!gameId) return badRequest("gameId is required");
  if (!commandType) return badRequest("commandType is required");

  const payloadValidation = validateCommandPayload(commandType, payload);
  if (!payloadValidation.valid) {
    return badRequest(payloadValidation.reason ?? "Invalid command payload");
  }

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

    if (membershipErr) return serverError("Failed to check membership");
    if (!membership) return forbidden("Not a member of this game");

    const { data: gameRow, error: gameErr } = await service
      .schema("secret_toaster")
      .from("games")
      .select("round")
      .eq("id", gameId)
      .single();

    const game = gameRow as GameRoundRow | null;

    if (gameErr || !game) return serverError("Failed to load game round");

    const eventPayload = {
      round: game.round,
      commandType,
      payload: payloadValidation.normalizedPayload ?? payload,
      source: "edge-function",
      version: 1,
    };

    const { data: inserted, error: eventErr } = await service
      .schema("secret_toaster")
      .from("game_events")
      .insert({
        game_id: gameId,
        event_type: "command.received",
        payload: eventPayload,
        caused_by: userId,
      })
      .select("id, created_at")
      .single();

    if (eventErr || !inserted) return serverError("Failed to append command event");

    return json(200, {
      ok: true,
      accepted: true,
      round: game.round,
      eventId: inserted.id,
      createdAt: inserted.created_at,
    });
  } catch (error) {
    console.error("secret-toaster-apply-command error", error);
    return serverError();
  }
});
