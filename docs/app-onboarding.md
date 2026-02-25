# App Onboarding to Shared Supabase

## Purpose

Standardize how new apps are onboarded to the shared platform.

## Onboarding sequence

1. Register app in `core.apps`.
2. Create dedicated schema (`<app_schema>`).
3. Add app tables and constraints.
4. Add RLS policies tied to app membership.
5. Add RPC/edge functions for sensitive mutations.
6. Validate with test data and smoke checks.

## Required app decisions

- schema name
- user access model (owner/member/admin)
- event logging requirements
- realtime requirements

## Required artifacts

- migration files
- RLS policy definitions
- function contracts
- minimal runbook notes

## Security baseline

- no privileged direct client writes
- app membership checks for protected operations
- audit/event logging for critical operations

## Current priority apps

- Secret Toaster (first)
- Wellness Tracker (next)
