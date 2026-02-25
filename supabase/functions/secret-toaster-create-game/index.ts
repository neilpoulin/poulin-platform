import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, json, serverError, unauthorized } from "../_shared/http.ts";
import { hashPassword } from "../_shared/password.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type CreateGameBody = {
  title?: string;
  password?: string;
};

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length > 0 ? title.slice(0, 120) : null;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const password = value.trim();
  return password.length > 0 ? password : null;
}

function generateGameCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const length = 6;
  let code = "";

  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    code += alphabet[index];
  }

  return code;
}

async function getOrCreateAppId(service: ReturnType<typeof createServiceClient>): Promise<string | null> {
  const { data: existing, error: existingError } = await service
    .schema("core")
    .from("apps")
    .select("id")
    .eq("slug", "secret-toaster")
    .maybeSingle();

  if (!existingError && existing) {
    return existing.id;
  }

  const { data: created, error: createError } = await service
    .schema("core")
    .from("apps")
    .upsert(
      {
        slug: "secret-toaster",
        name: "Secret Toaster",
        description: "Turn-based strategy game with invites, events, and chat",
        is_active: true,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (createError || !created) {
    return null;
  }

  return created.id;
}

async function createGameWithUniqueCode(input: {
  service: ReturnType<typeof createServiceClient>;
  appId: string;
  userId: string;
  title: string | null;
  passwordHash: string | null;
}): Promise<{ id: string; game_code: string } | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const gameCode = generateGameCode();

    const { data, error } = await input.service
      .schema("secret_toaster")
      .from("games")
      .insert({
        app_id: input.appId,
        game_code: gameCode,
        title: input.title,
        created_by: input.userId,
        status: "lobby",
        round: 0,
        is_private: true,
        join_password_hash: input.passwordHash,
      })
      .select("id, game_code")
      .single();

    if (!error && data) return data;

    if (error && error.code === "23505") {
      continue;
    }

    throw error;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return badRequest("POST required");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return unauthorized();

  let body: CreateGameBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const userClient = createUserClient(authHeader);
  const service = createServiceClient();

  const userId = await getAuthedUserId(userClient);
  if (!userId) return unauthorized();

  try {
    const appId = await getOrCreateAppId(service);
    if (!appId) return serverError("secret-toaster app is not registered in core.apps");

    const title = normalizeTitle(body.title);
    const password = normalizePassword(body.password);
    const passwordHash = password ? await hashPassword(password) : null;

    const game = await createGameWithUniqueCode({
      service,
      appId,
      userId,
      title,
      passwordHash,
    });

    if (!game) return serverError("Failed to create game after retries");

    const { error: membershipErr } = await service.schema("secret_toaster").from("game_memberships").insert({
      game_id: game.id,
      user_id: userId,
      role: "owner",
      is_active: true,
    });

    if (membershipErr) return serverError("Failed to create owner membership");

    const { error: eventErr } = await service.schema("secret_toaster").from("game_events").insert({
      game_id: game.id,
      event_type: "game.created",
      payload: {
        gameCode: game.game_code,
        title,
      },
      caused_by: userId,
    });

    if (eventErr) return serverError("Failed to append game.created event");

    return json(200, {
      ok: true,
      gameId: game.id,
      gameCode: game.game_code,
      title,
    });
  } catch (error) {
    console.error("secret-toaster-create-game error", error);
    return serverError();
  }
});
