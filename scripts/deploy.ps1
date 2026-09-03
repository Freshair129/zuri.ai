<#
.SYNOPSIS
  Build and start the zuri-ai Docker Compose stack (web + ngrok, optional local Postgres).

.DESCRIPTION
  Idempotent: safe to run again after a code change or a reboot. Reads .env (and the
  optional .env.docker) from the repository root — nothing is passed on the command
  line, so no secret ends up in shell history. See docs/deployment/docker-ngrok.md.

.PARAMETER NoBuild
  Skip `docker compose build` (start whatever image is already present or pulled).

.PARAMETER Pull
  Pull the pinned third-party images (ngrok, postgres) before starting.

.EXAMPLE
  .\scripts\deploy.ps1
  .\scripts\deploy.ps1 -Pull
#>
[CmdletBinding()]
param(
  [switch]$NoBuild,
  [switch]$Pull
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Assert-LastExit([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "[zuri] $step failed (exit $LASTEXITCODE)" }
}

if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) {
  throw "[zuri] .env is missing. Copy .env.example to .env, fill DATABASE_URL, ZURI_SESSION_SECRET and NGROK_AUTHTOKEN, then run again."
}

# Only the NAMES of required variables are checked; values are never printed.
$envText = Get-Content -LiteralPath (Join-Path $root '.env') -Raw
foreach ($name in @('NGROK_AUTHTOKEN', 'ZURI_SESSION_SECRET')) {
  if ($envText -notmatch "(?m)^\s*$name\s*=\s*\S") {
    Write-Warning "[zuri] $name is not set in .env — the stack will start but the $name-dependent service will fail."
  }
}

docker info --format '{{.ServerVersion}}' | Out-Null
Assert-LastExit 'docker info (is Docker Desktop running?)'

docker compose config --quiet
Assert-LastExit 'docker compose config'

if ($Pull) {
  docker compose pull --ignore-buildable
  Assert-LastExit 'docker compose pull'
}

if (-not $NoBuild) {
  docker compose build
  Assert-LastExit 'docker compose build'
}

docker compose up -d --remove-orphans
Assert-LastExit 'docker compose up'

docker compose ps
Assert-LastExit 'docker compose ps'

& (Join-Path $PSScriptRoot 'ngrok-url.ps1')
