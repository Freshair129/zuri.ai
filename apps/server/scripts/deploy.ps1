<#
.SYNOPSIS
  Build and start the zuri-ai Docker Compose stack locally, with optional public ingress.

.DESCRIPTION
  Idempotent: safe to run again after a code change or a reboot. The script resolves
  its Server app directory. A custom EnvironmentFile must also select the runtime
  env_file paths; isolated Compose projects must use image tags unique to this
  checkout. Secret values are not passed on the command line. See
  docs/deployment/docker-ngrok.md.

.PARAMETER NoBuild
  Skip `docker compose build` (start whatever image is already present or pulled).

.PARAMETER Pull
  Pull the pinned third-party images (ngrok, postgres) before starting.

.PARAMETER Public
  Opt in to ngrok ingress. Requires NGROK_AUTHTOKEN and an assigned NGROK_DOMAIN.

.PARAMETER EnvironmentFile
  Private Compose interpolation file, relative to apps/server unless absolute.
  For a custom file, set ZURI_WEB_ENV_FILE there to the intended runtime file.

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

$defaultEnvironmentPath = [System.IO.Path]::GetFullPath((Join-Path $root '.env'))
$isDefaultEnvironment = [string]::Equals(
  [System.IO.Path]::GetFullPath($environmentPath),
  $defaultEnvironmentPath,
  [System.StringComparison]::OrdinalIgnoreCase
)
if (-not $isDefaultEnvironment) {
  $environmentFileText = Get-Content -LiteralPath $environmentPath -Raw
  $runtimeSelector = [regex]::Match($environmentFileText, '(?m)^\s*(?:export\s+)?ZURI_WEB_ENV_FILE\s*=\s*(.*)$')
  $runtimeSelectorValue = if ($runtimeSelector.Success) { $runtimeSelector.Groups[1].Value.Trim() } else { $env:ZURI_WEB_ENV_FILE }
  if ([string]::IsNullOrWhiteSpace($runtimeSelectorValue) -or $runtimeSelectorValue -in @('""', "''")) {
    throw '[zuri] A custom -EnvironmentFile must set ZURI_WEB_ENV_FILE to the intended container runtime env file.'
  }

  $dockerSelector = [regex]::Match($environmentFileText, '(?m)^\s*(?:export\s+)?ZURI_WEB_DOCKER_ENV_FILE\s*=\s*(.*)$')
  $dockerSelectorValue = if ($dockerSelector.Success) { $dockerSelector.Groups[1].Value.Trim() } else { $env:ZURI_WEB_DOCKER_ENV_FILE }
  if ([string]::IsNullOrWhiteSpace($dockerSelectorValue) -and (Test-Path -LiteralPath (Join-Path $root '.env.docker') -PathType Leaf)) {
    throw '[zuri] A custom -EnvironmentFile must set ZURI_WEB_DOCKER_ENV_FILE explicitly when apps/server/.env.docker exists.'
  }
}

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

function Resolve-ServerPath([string]$path) {
  if ([System.IO.Path]::IsPathRooted($path)) { return [System.IO.Path]::GetFullPath($path) }
  return [System.IO.Path]::GetFullPath((Join-Path $root $path))
}

$activeProfiles = @((Get-ResolvedComposeValue 'COMPOSE_PROFILES').Split(',') | ForEach-Object { $_.Trim() })

if (-not $isDefaultEnvironment) {
  $runtimeEnvironmentFile = Get-ResolvedComposeValue 'ZURI_WEB_ENV_FILE'
  if ([string]::IsNullOrWhiteSpace($runtimeEnvironmentFile)) {
    throw '[zuri] A custom -EnvironmentFile must set ZURI_WEB_ENV_FILE to the intended container runtime env file.'
  }
  if (-not (Test-Path -LiteralPath (Resolve-ServerPath $runtimeEnvironmentFile) -PathType Leaf)) {
    throw '[zuri] ZURI_WEB_ENV_FILE does not resolve to an existing file.'
  }

}

if ($ProjectName) {
  $webImage = Get-ResolvedComposeValue 'ZURI_WEB_IMAGE'
  if ([string]::IsNullOrWhiteSpace($webImage) -or $webImage -eq 'zuri-ai-web:local') {
    throw '[zuri] A named Compose project must set a checkout-specific ZURI_WEB_IMAGE to avoid cross-checkout retagging.'
  }
  if ($activeProfiles -contains 'local-db') {
    $toolsImage = Get-ResolvedComposeValue 'ZURI_TOOLS_IMAGE'
    if ([string]::IsNullOrWhiteSpace($toolsImage) -or $toolsImage -eq 'zuri-ai-tools:local') {
      throw '[zuri] A named local-db project must set a checkout-specific ZURI_TOOLS_IMAGE to avoid cross-checkout retagging.'
    }
  }
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
  $inspectPortText = Get-ResolvedComposeValue 'NGROK_INSPECT_PORT'
  $inspectPort = 4040
  if (-not [string]::IsNullOrWhiteSpace($inspectPortText)) {
    $parsedPort = 0
    if (-not [int]::TryParse($inspectPortText, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
      throw '[zuri] NGROK_INSPECT_PORT must be an integer between 1 and 65535.'
    }
    $inspectPort = $parsedPort
  }
  & (Join-Path $PSScriptRoot 'ngrok-url.ps1') -Port $inspectPort
}
