import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, forbidden, json, serverError, unauthorized } from "../_shared/http.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type CreateInviteBody = {
  gameId?: string;
  invitedEmail?: string;
  expiresInHours?: number;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 ? email : null;
}

function normalizeExpiresInHours(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 72;
  return Math.max(1, Math.min(24 * 14, Math.floor(value)));
}

function generateInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: CreateInviteBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  if (!gameId) return badRequest("gameId is required");

  const invitedEmail = normalizeEmail(body.invitedEmail);
  const expiresInHours = normalizeExpiresInHours(body.expiresInHours);

  const userClient = createUserClient(authHeader);
  const service = createServiceClient();

  const userId = await getAuthedUserId(userClient);
  if (!userId) return unauthorized();

  try {
    const { data: ownerMembership, error: ownerErr } = await service
      .schema("secret_toaster")
      .from("game_memberships")
      .select("id")
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .eq("role", "owner")
      .eq("is_active", true)
      .maybeSingle();

    if (ownerErr) return serverError("Failed to verify owner membership");
    if (!ownerMembership) return forbidden("Only active game owners can create invite tokens");

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    const token = generateInviteToken();

    const { data: invite, error: inviteErr } = await service
      .schema("secret_toaster")
      .from("game_invites")
      .insert({
        game_id: gameId,
        token,
        created_by: userId,
        invited_email: invitedEmail,
        expires_at: expiresAt,
      })
      .select("id, token, expires_at")
      .single();

    if (inviteErr || !invite) return serverError("Failed to create invite");

    await service.schema("secret_toaster").from("game_events").insert({
      game_id: gameId,
      event_type: "invite.created",
      payload: {
        inviteId: invite.id,
        invitedEmail,
        expiresAt: invite.expires_at,
      },
      caused_by: userId,
    });

    return json(200, {
      ok: true,
      gameId,
      inviteToken: invite.token,
      expiresAt: invite.expires_at,
    });
  } catch (error) {
    console.error("secret-toaster-create-invite error", error);
    return serverError();
  }
});
