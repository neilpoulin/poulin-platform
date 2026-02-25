# Supabase Edge Functions

## How endpoints are named

Supabase edge functions are addressed by function slug:

- `https://<project-ref>.functions.supabase.co/<function-name>`
- or via project URL proxy: `https://<project-ref>.supabase.co/functions/v1/<function-name>`

Function names are a single slug (no nested path segments). For namespacing, use prefixes:

- `secret-toaster-join-game`
- `secret-toaster-apply-command`

## Where code lives

- `supabase/functions/_shared/*` shared helpers
- `supabase/functions/secret-toaster-create-game/index.ts`
- `supabase/functions/secret-toaster-create-invite/index.ts`
- `supabase/functions/secret-toaster-join-game/index.ts`
- `supabase/functions/secret-toaster-set-ready/index.ts`
- `supabase/functions/secret-toaster-apply-command/index.ts`

## Auth model

- Deploy with `verify_jwt = true`.
- Client calls with user access token in `Authorization` header.
- Function verifies caller identity and enforces authorization rules.
- Service role usage stays server-side only.

## Deploy flow

1. Link project:

```bash
supabase link --project-ref pbasbmocqguzysofwqoy
```

2. Set required secrets:

```bash
supabase secrets set SUPABASE_URL="https://pbasbmocqguzysofwqoy.supabase.co"
supabase secrets set SUPABASE_ANON_KEY="<anon-key>"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

3. Deploy functions:

```bash
supabase functions deploy secret-toaster-join-game
supabase functions deploy secret-toaster-apply-command
supabase functions deploy secret-toaster-create-game
supabase functions deploy secret-toaster-create-invite
supabase functions deploy secret-toaster-set-ready
```

4. Invoke from client:

```ts
await supabase.functions.invoke("secret-toaster-create-game", {
  body: { title: "Friday Match", password: "toasty" },
});
await supabase.functions.invoke("secret-toaster-create-invite", {
  body: { gameId: "<game-id>", expiresInHours: 72 },
});
await supabase.functions.invoke("secret-toaster-set-ready", {
  body: { gameId: "<game-id>", isReady: true },
});
await supabase.functions.invoke("secret-toaster-join-game", { body: { inviteToken } });
await supabase.functions.invoke("secret-toaster-apply-command", { body: { gameId, commandType, payload } });
```
