# Migration Governance and Release Policy

## Core rules

1. Migrations are append-only after apply.
2. Every migration is reviewed through PR.
3. Production migration apply requires manual approval.
4. Breaking changes follow expand -> migrate -> contract.

## Naming convention

Use:

`YYYYMMDDHHMM__<schema>__<purpose>.sql`

Examples:
- `202602242200__core__create_apps_profiles_memberships.sql`
- `202602242215__secret_toaster__create_games_events_chat.sql`

## Scope guidelines

- Prefer one migration per bounded concern.
- Document cross-schema references directly in SQL comments.
- Keep app concerns inside app schema.

## PR checklist

Each migration PR should include:
- problem and intended outcome
- affected schemas/tables/functions
- RLS impact summary
- rollback/mitigation notes
- downstream app impact summary

## Environment policy

- Dev/preview: automatic apply allowed
- Production: manual approval gate required

## Emergency changes

- Use a dedicated hotfix migration
- Link incident context
- Add follow-up hardening issue
