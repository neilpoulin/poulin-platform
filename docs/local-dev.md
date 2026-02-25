# Local Dev Environment

Use this flow to test migrations and edge functions before any deployment.

## Prerequisites

- Supabase CLI installed (`supabase --version`)
- Docker running (for local Supabase stack)
- Project already initialized with `supabase/config.toml`

## 1) Start local Supabase stack

```bash
supabase start
```

Local services:
- API: `http://127.0.0.1:54321`
- DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio: `http://127.0.0.1:54323`

## 2) Apply local migrations

```bash
supabase db reset
```

This applies migrations from `supabase/migrations` and then `supabase/seed.sql`.

## 3) Configure function env

Create local env file for functions:

```bash
cp supabase/functions/.env.example supabase/functions/.env.local
```

Then set values in `.env.local`.

For local-only testing against the local stack, use local URL and keys from `supabase start` output.

## 4) Serve functions locally

```bash
supabase functions serve secret-toaster-join-game --env-file supabase/functions/.env.local --no-verify-jwt
supabase functions serve secret-toaster-apply-command --env-file supabase/functions/.env.local --no-verify-jwt
supabase functions serve secret-toaster-create-game --env-file supabase/functions/.env.local --no-verify-jwt
supabase functions serve secret-toaster-create-invite --env-file supabase/functions/.env.local --no-verify-jwt
```

Endpoint format:

- `http://127.0.0.1:54321/functions/v1/secret-toaster-join-game`
- `http://127.0.0.1:54321/functions/v1/secret-toaster-apply-command`
- `http://127.0.0.1:54321/functions/v1/secret-toaster-create-game`
- `http://127.0.0.1:54321/functions/v1/secret-toaster-create-invite`

## 5) Quick smoke tests

Example apply-command call:

```bash
curl -i "http://127.0.0.1:54321/functions/v1/secret-toaster-apply-command" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"00000000-0000-0000-0000-000000000000","commandType":"order.submit","payload":{}}'
```

When you are ready to test auth behavior, remove `--no-verify-jwt` and send a valid user bearer token.

You can also run both function checks with:

```bash
./scripts/smoke-functions.sh
```

Optional environment overrides:

```bash
BASE_URL="http://127.0.0.1:54321/functions/v1" \
GAME_ID="00000000-0000-0000-0000-000000000000" \
INVITE_TOKEN="dummy-token" \
./scripts/smoke-functions.sh
```

## 6) Stop local stack

```bash
supabase stop
```
