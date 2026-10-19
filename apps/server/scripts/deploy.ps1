<#
.SYNOPSIS
  Build and start the zuri-ai Docker Compose stack locally, with optional public ingress.

.DESCRIPTION
  Idempotent: safe to run again after a code change or a reboot. The script resolves
  its Server app directory and reads apps/server/.env (and the optional
  apps/server/.env.docker) — nothing is passed on the command line, so no secret
  ends up in shell history. See docs/deployment/docker-ngrok.md.

.PARAMETER NoBuild
  Skip `docker compose build` (start whatever image is already present or pulled).

.PARAMETER Pull
  Pull the pinned third-party images (ngrok, postgres) before starting.

.PARAMETER Public
  Opt in to ngrok ingress. Requires NGROK_AUTHTOKEN and an assigned NGROK_DOMAIN.

.PARAMETER EnvironmentFile
  Private Compose interpolation/env file, relative to apps/server unless absolute.

.PARAMETER ProjectName
  Optional Compose project name for an isolated deployment.

.EXAMPLE
  .\scripts\deploy.ps1
  .\scripts\deploy.ps1 -EnvironmentFile .env.knowledge-studio.local -ProjectName zuri-knowledge-studio-local
  .\scripts\deploy.ps1 -Public
  .\scripts\deploy.ps1 -Pull
#>
[CmdletBinding()]
param(
  [switch]$NoBuild,
  [switch]$Pull,
  [switch]$Public,
  [string]$EnvironmentFile = '.env',
  [string]$ProjectName
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $root)
Set-Location $root

function Assert-LastExit([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "[zuri] $step failed (exit $LASTEXITCODE)" }
}

$environmentPath = if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) {
  $EnvironmentFile
} else {
  Join-Path $root $EnvironmentFile
}
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw "[zuri] Compose environment file is missing: $EnvironmentFile"
}
if ($ProjectName -and $ProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {
  throw '[zuri] ProjectName must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores or hyphens.'
}

$composeOptions = @('--env-file', $environmentPath)
if ($ProjectName) { $composeOptions += @('--project-name', $ProjectName) }

$composeEnvironment = @(docker compose @composeOptions config --environment)
Assert-LastExit 'docker compose resolved environment'
function Get-ResolvedComposeValue([string]$name) {
  foreach ($line in $composeEnvironment) {
    if ($line -match "^$([regex]::Escape($name))=(.*)$") {
      return $Matches[1]
    }
  }
  return ''
}
function Has-ResolvedComposeValue([string]$name) {
  return -not [string]::IsNullOrWhiteSpace((Get-ResolvedComposeValue $name))
}

if (-not (Has-ResolvedComposeValue 'ZURI_SESSION_SECRET')) {
  Write-Warning '[zuri] ZURI_SESSION_SECRET is not set in the resolved Compose environment.'
}
if ($Public) {
  foreach ($name in @('NGROK_AUTHTOKEN', 'NGROK_DOMAIN')) {
    if (-not (Has-ResolvedComposeValue $name)) {
      throw "[zuri] -Public requires $name in the resolved Compose environment; no public tunnel was started."
    }
  }
} else {
  $activeProfiles = @((Get-ResolvedComposeValue 'COMPOSE_PROFILES').Split(',') | ForEach-Object { $_.Trim() })
  if ($activeProfiles -contains 'public') {
    throw '[zuri] COMPOSE_PROFILES activates public ingress. Remove public for local-only deployment, or use -Public with a token and assigned domain.'
  }
  Write-Host '[zuri] Local-only deployment; ngrok is disabled. Use -Public with a token and assigned domain to opt in.'
}

docker info --format '{{.ServerVersion}}' | Out-Null
Assert-LastExit 'docker info (is Docker Desktop running?)'

docker compose @composeOptions config --quiet
Assert-LastExit 'docker compose config'

# @req FR-289 — prepare the generated document graph before a Knowledge Studio deployment.
# @tested tests/unit/knowledge-studio/docker-runtime.test.js — pins the deploy guard and graph-before-build order.
# FR-289 consumes a generated graph mounted from the canonical repository docs.
# Refresh that ignored artifact from source before building or starting the stack.
Push-Location $repoRoot
npm run docs:graph
Assert-LastExit 'docs:graph'
Pop-Location

if ($Pull) {
  docker compose @composeOptions pull --ignore-buildable
  Assert-LastExit 'docker compose pull'
}

if (-not $NoBuild) {
  docker compose @composeOptions build
  Assert-LastExit 'docker compose build'
}

if ($Public) {
  docker compose @composeOptions --profile public up -d --remove-orphans
  Assert-LastExit 'docker compose public up'
} else {
  docker compose @composeOptions up -d --remove-orphans web
  Assert-LastExit 'docker compose local up'
}

docker compose @composeOptions ps
Assert-LastExit 'docker compose ps'

if ($Public) {
  & (Join-Path $PSScriptRoot 'ngrok-url.ps1')
}
