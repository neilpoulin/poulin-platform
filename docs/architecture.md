# Shared Supabase Architecture (v1)

## Objective

Provide a single Supabase project that safely supports multiple small apps using schema isolation, shared auth, and strict RLS boundaries.

## Repository ownership

This repository owns:
- `supabase/migrations`
- `supabase/functions`
- schema and release governance documentation

Application repos should not ship direct schema changes outside this repo.

## Schema strategy

- `core`: shared cross-app primitives
- `secret_toaster`: game-specific tables and functions
- `wellness_tracker`: fitness app tables and functions (planned)

`public` should remain minimal; app data belongs in app schemas.

## Shared auth model

- Single Supabase project with shared `auth.users`
- Shared account identities across apps
- Per-app authorization through membership checks

Note: this is shared identity, not full cross-domain session SSO.

## Secret Toaster model

- No dedicated backend service in v1
- Backend authority through edge functions + RLS + SQL constraints
- Mutation path: client -> edge function -> validated write -> event append

## Data pattern

Use snapshot + events where needed:
- current-state tables for fast reads
- append-only event tables for history/audit/replay

## Security principles

- RLS on all app tables
- No privileged direct client writes for sensitive operations
- Membership checks tied to `core.user_app_memberships`

## Hosting

- Frontend apps: Vercel
- Data/Auth/Realtime/Edge Functions: Supabase

## CI/CD expectations

- Path-filtered workflows in app repos
- Migration validation in PRs
- Manual approval before production migration apply
