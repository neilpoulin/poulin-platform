import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { getAuthedUserId } from "../_shared/auth.ts";
import { badRequest, json, serverError, unauthorized } from "../_shared/http.ts";
import { hashPassword } from "../_shared/password.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

type CreateGameBody = {
  title?: string;
  password?: string;
};

type SeededGameState = {
  round: number;
  hexes: Record<
    string,
    {
      ownerUserId: string;
      troopCount: number;
      knightCount: number;
    }
  >;
  players: Record<
    string,
    {
      startingKeepId: number;
      unassignedTroops: number;
      unassignedKnights: number;
    }
  >;
};

const LEGACY_BOARD_WIDTH = 10;
const LEGACY_BOARD_HEIGHT = 11;
const LEGACY_KEEP_IDS = [23, 26, 52, 58, 83, 86] as const;
const STARTING_TROOPS = 100;
const STARTING_KNIGHTS = 1;

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

function legacyBoardX(index: number): number {
  return index % LEGACY_BOARD_WIDTH;
}

function legacyBoardY(index: number): number {
  return Math.floor(index / LEGACY_BOARD_WIDTH);
}

function legacyBoardIndex(x: number, y: number): number {
  return x + LEGACY_BOARD_WIDTH * y;
}

function getLegacyHexNeighbors(index: number): Array<number | null> {
  const x = legacyBoardX(index);
  const y = legacyBoardY(index);

  const points: Array<[number, number]> = y % 2 !== 0
    ? [
        [x, y - 1],
        [x + 1, y],
        [x, y + 1],
        [x - 1, y + 1],
        [x - 1, y],
        [x - 1, y - 1],
      ]
    : [
        [x + 1, y - 1],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x - 1, y],
        [x, y - 1],
      ];

  return points.map(([nx, ny]) => {
    if (nx < 0 || nx >= LEGACY_BOARD_WIDTH || ny < 0 || ny >= LEGACY_BOARD_HEIGHT) {
      return null;
    }

    return legacyBoardIndex(nx, ny);
  });
}

function buildStartingStateForOwner(ownerUserId: string): {
  startingKeepId: number;
  state: SeededGameState;
} {
  const keepIndex = Math.floor(Math.random() * LEGACY_KEEP_IDS.length);
  const startingKeepId = LEGACY_KEEP_IDS[keepIndex];
  const neighboringHexIds = getLegacyHexNeighbors(startingKeepId).filter((hexId): hexId is number => hexId !== null);

  const hexes: SeededGameState["hexes"] = {
    [String(startingKeepId)]: {
      ownerUserId,
      troopCount: STARTING_TROOPS,
      knightCount: STARTING_KNIGHTS,
    },
  };

  for (const neighborHexId of neighboringHexIds) {
    hexes[String(neighborHexId)] = {
      ownerUserId,
      troopCount: 0,
      knightCount: 0,
    };
  }

  return {
    startingKeepId,
    state: {
      round: 0,
      hexes,
      players: {
        [ownerUserId]: {
          startingKeepId,
          unassignedTroops: 0,
          unassignedKnights: Math.max(0, 3 - STARTING_KNIGHTS),
        },
      },
    },
  };
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
  currentState: SeededGameState;
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
        current_state: input.currentState,
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
    const seeded = buildStartingStateForOwner(userId);

    const game = await createGameWithUniqueCode({
      service,
      appId,
      userId,
      title,
      passwordHash,
      currentState: seeded.state,
    });

    if (!game) return serverError("Failed to create game after retries");

    const { error: membershipErr } = await service.schema("secret_toaster").from("game_memberships").insert({
      game_id: game.id,
      user_id: userId,
      role: "owner",
      is_active: true,
    });

    if (membershipErr) return serverError("Failed to create owner membership");

    const { error: eventErr } = await service.schema("secret_toaster").from("game_events").insert([
      {
        game_id: game.id,
        event_type: "game.created",
        payload: {
          gameCode: game.game_code,
          title,
        },
        caused_by: userId,
      },
      {
        game_id: game.id,
        event_type: "game.state_seeded",
        payload: {
          startingKeepId: seeded.startingKeepId,
          startingTroops: STARTING_TROOPS,
          startingKnights: STARTING_KNIGHTS,
        },
        caused_by: userId,
      },
    ]);

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
