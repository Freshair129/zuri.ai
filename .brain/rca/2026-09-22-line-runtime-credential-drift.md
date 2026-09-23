# RCA — TASK-ZAI-001 dedicated LINE runtime credential drift

## Symptom

The controlled production MSP memory canary was admitted with
`memorySyncOptIn=true`, but the LINE worker failed before it could produce an
MSP delivery or context receipt.

## Evidence

- The deployed `ZURI_LINE_DB_URL` initially used the pooler username
  `zuri_line_smartgift_login` without the Supabase project reference; the
  runtime probe returned `ENOIDENTIFIER` from Supavisor.
- After the username was corrected to the project-qualified pooler form, the
  same deployment credential returned PostgreSQL `28P01` for
  `zuri_line_smartgift_login`.
- The general application connection authenticates as `zuri_web_login`, which
  is non-privileged and has no role-creation privilege; it cannot safely rotate
  the dedicated login and must not be substituted for the read-only runtime
  boundary.
- Windows Credential Manager had no matching runtime entry during the repair
  attempt. No password was guessed, printed, committed or copied into the
  report.

## Root Cause

The deployment carried a stale or invalid password for the dedicated SmartGift
runtime role, and the pooler username contract was also incomplete. Fixing the
routing shape exposed the stale credential as an authentication failure before
model setup and MSP memory delivery.

## Why the issue escaped detection

The repository contract tests covered URL validation and direct role shape but
did not authenticate the exact deployment credential against the current
Supavisor tenant. Earlier live checks used Project/Work tool paths that did not
require the model/memory database read.

## Proposed prevention

Provision the dedicated role credential through the approved secret owner,
validate the exact project-qualified pooler URL with a read-only login probe,
and record only a redacted receipt containing `current_user`, role privilege
flags and a harmless query result. Keep the app role and dedicated runtime role
separate, and make the memory canary a prerequisite to any roadmap transition.
