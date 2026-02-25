# Poulin Platform

Shared Supabase platform repository for Poulin projects.

This repository is the source of truth for:
- Supabase migrations
- Supabase edge functions
- shared schema governance and onboarding docs

## Scope

Initial app schemas:
- `core` (shared cross-app primitives)
- `secret_toaster`
- `wellness_tracker` (planned)

Out of scope for now:
- StrumbyStrum migration
- full cross-domain seamless SSO

## Repo layout

```text
supabase/
  migrations/
  functions/
docs/
  architecture.md
  migration-policy.md
  app-onboarding.md
  edge-functions.md
  local-dev.md
```

## Migration policy (short)

- Migrations are append-only once applied.
- Production migration applies require manual approval.
- Breaking changes must use expand -> migrate -> contract.

See `docs/migration-policy.md` for details.
