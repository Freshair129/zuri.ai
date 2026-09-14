<#
.SYNOPSIS
  Register the Windows Task Scheduler entry for the FR-230 nightly CRM
  retention sweep (ADR-091 D1, D2) — run ONCE by a human operator on the
  production host. This script only REGISTERS the task; it does not run the
  sweep itself, and running this file does not touch any Tenant's data.

.DESCRIPTION
  The owner's decision (2026-09-14): run the sweep once a day at 03:00 local
  time. This repo's worker pattern is "a route + an external caller" (see
  scripts/server-line-worker.mjs / docker-compose.yml's `line-worker` service)
  — but that pattern is for continuous polling. This job runs once a day, so
  it does NOT get an always-on container; instead the OS scheduler invokes a
  single-shot script (scripts/server-retention-sweep-worker.mjs) once, and the
  process exits.

  The scheduled action runs that script INSIDE the already-running `web`
  container via `docker compose exec`, not on the Windows host directly:
    - `web`'s env_file already carries ZURI_RETENTION_SWEEP_TOKEN once it is
      set in apps/server/.env — no second copy of the secret on the host, no
      Windows Credential Manager entry to keep in sync with .env.
    - The container already has network access to itself (the worker's
      default endpoint is http://127.0.0.1:3000/api/crm/retention-sweep) and
      the exact pinned Node runtime the image ships — nothing to install or
      version-match on the host.
    - It is the same mechanism this repo already documents for one-off
      commands against the live stack (`docker compose exec`), rather than a
      second, host-side way of reaching the app.
  Calling the route directly from the host (Invoke-RestMethod against
  ${WEB_BIND_ADDRESS}:${WEB_PORT}) would also work and was considered — it is
  one HTTP call, no docker dependency in the scheduled action itself — but it
  would need the token to ALSO live in a Windows secret store or a second env
  file on the host, kept in sync with apps/server/.env by hand. Running inside
  the container avoids that second secret copy entirely, at the cost of the
  scheduled action depending on `docker` being on the operator's PATH — judged
  the better trade on a host that already runs this stack under Docker
  Compose as its only production runtime (ADR-058).

.PARAMETER RepoServerPath
  Absolute path to this checkout's apps/server directory on the production
  host — e.g. "D:\zuri-ai\apps\server" or "C:\Users\pc\workspace\zuri-ai\apps\server".
  `docker compose exec` is run with this as its working directory, per this
  repo's own rule that every compose command runs from apps/server (CLAUDE.md).

.PARAMETER At
  Local time of day to run. Default 03:00 (the owner's decision).

.PARAMETER TaskName
  Scheduled task name. Default 'ZuriAI-RetentionSweep'.

.EXAMPLE
  # Dry run — prints what would be registered without touching the Task Scheduler.
  .\scripts\register-retention-sweep-task.ps1 -RepoServerPath 'D:\zuri-ai\apps\server' -WhatIf

.EXAMPLE
  # Actually register it. Requires apps/server/.env to already set
  # ZURI_RETENTION_SWEEP_TOKEN (>= 32 random characters) on this host BEFORE
  # the first scheduled run, or every run answers 401 and does nothing.
  .\scripts\register-retention-sweep-task.ps1 -RepoServerPath 'D:\zuri-ai\apps\server'

.NOTES
  This file is a deliverable for a human operator to run by hand on the
  production host. It is not invoked by any test, migration, `npm run govern`,
  build step, or CI job in this repository, and this session never ran it.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoServerPath,

  [datetime]$At = [datetime]::Parse('03:00'),

  [string]$TaskName = 'ZuriAI-RetentionSweep'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath (Join-Path $RepoServerPath 'docker-compose.yml'))) {
  throw "[zuri] $RepoServerPath does not look like apps/server (docker-compose.yml not found there)."
}
$envPath = Join-Path $RepoServerPath '.env'
if (-not (Test-Path -LiteralPath $envPath) -or (Get-Content -LiteralPath $envPath -Raw) -notmatch '(?m)^\s*ZURI_RETENTION_SWEEP_TOKEN\s*=\s*\S') {
  Write-Warning "[zuri] ZURI_RETENTION_SWEEP_TOKEN is not set in $envPath yet — the scheduled task will register, but every run will answer 401 until it is set and the stack is restarted."
}

# `-T`: no pseudo-tty, matching every other non-interactive `docker compose exec`
# use in this repo's own scripts. `web` is the compose SERVICE name (docker-compose.yml
# `name: zuri-ai` pins the project regardless of which checkout runs the command —
# see CLAUDE.md "A worktree isolates git, not Docker" — so this always reaches the
# one live stack, never a worktree's own containers).
$action = New-ScheduledTaskAction -Execute 'docker' `
  -Argument 'compose exec -T web node scripts/server-retention-sweep-worker.mjs' `
  -WorkingDirectory $RepoServerPath

$trigger = New-ScheduledTaskTrigger -Daily -At $At

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 1 `
  -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'FR-230 nightly CRM retention sweep (ADR-091 D1, D2). Runs scripts/server-retention-sweep-worker.mjs once daily inside the running `web` container via docker compose exec. Registered by scripts/register-retention-sweep-task.ps1.'

Write-Host "[zuri] Registered scheduled task '$TaskName' — daily at $($At.ToString('HH:mm')) local time."
Write-Host "[zuri] Verify: Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "[zuri] Run once now to check credentials/wiring: Start-ScheduledTask -TaskName '$TaskName'; Start-Sleep 5; Get-ScheduledTaskInfo -TaskName '$TaskName'"
