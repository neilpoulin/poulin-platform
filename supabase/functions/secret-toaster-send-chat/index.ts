import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type SendChatBody = {
  gameId?: string;
  message?: string;
  messageType?: "GLOBAL" | "ALLIANCE" | "DIRECT";
  allianceId?: string | null;
  recipientUserId?: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: SendChatBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const gameId = asText(body.gameId).trim();
  const message = asText(body.message).trim();
  const messageType = body.messageType ?? "GLOBAL";
  const allianceId = body.allianceId === null ? null : asText(body.allianceId).trim() || null;
  const recipientUserId = body.recipientUserId === null ? null : asText(body.recipientUserId).trim() || null;

  if (!gameId) return badRequest("gameId is required");
  if (message.length < 1 || message.length > 2000) return badRequest("message must be 1..2000 chars");
  if (!["GLOBAL", "ALLIANCE", "DIRECT"].includes(messageType)) {
    return badRequest("messageType must be GLOBAL, ALLIANCE, or DIRECT");
  }

  if (messageType === "ALLIANCE" && !allianceId) return badRequest("allianceId is required for ALLIANCE chat");
  if (messageType === "DIRECT" && !recipientUserId) return badRequest("recipientUserId is required for DIRECT chat");

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

    if (messageType === "ALLIANCE") {
      const { data: allianceMembership, error: allianceMembershipErr } = await service
        .schema("secret_toaster")
        .from("game_player_alliances")
        .select("alliance_id")
        .eq("game_id", gameId)
        .eq("user_id", userId)
        .maybeSingle();

      if (allianceMembershipErr) return serverError("Failed to verify alliance membership");
      if (!allianceMembership || allianceMembership.alliance_id !== allianceId) {
        return forbidden("You are not a member of that alliance");
      }
    }

    if (messageType === "DIRECT" && recipientUserId) {
      const { data: recipientMembership, error: recipientErr } = await service
        .schema("secret_toaster")
        .from("game_memberships")
        .select("id")
        .eq("game_id", gameId)
        .eq("user_id", recipientUserId)
        .eq("is_active", true)
        .maybeSingle();

      if (recipientErr) return serverError("Failed to validate direct message recipient");
      if (!recipientMembership) return badRequest("Recipient is not an active game member");
    }

    const { data: inserted, error: insertErr } = await service
      .schema("secret_toaster")
      .from("chat_messages")
      .insert({
        game_id: gameId,
        sender_user_id: userId,
        message,
        message_type: messageType,
        alliance_id: messageType === "ALLIANCE" ? allianceId : null,
        recipient_user_id: messageType === "DIRECT" ? recipientUserId : null,
      })
      .select("id, created_at")
      .single();

    if (insertErr || !inserted) return serverError("Failed to send chat message");

    return json(200, {
      ok: true,
      messageId: inserted.id,
      createdAt: inserted.created_at,
    });
  } catch (error) {
    console.error("secret-toaster-send-chat error", error);
    return serverError();
  }
});
