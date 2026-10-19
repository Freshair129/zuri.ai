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
$selectorHelpers = Join-Path $PSScriptRoot 'deploy-env-selectors.ps1'
. $selectorHelpers
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
if ($ProjectName -and $ProjectName.Length -gt 63) {
  throw '[zuri] ProjectName must be 63 characters or fewer so project-scoped Docker tags stay portable.'
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
  $runtimeSelectorValue = if ($runtimeSelector.Success) { Get-ComposePathSelector $runtimeSelector.Groups[1].Value 'ZURI_WEB_ENV_FILE' } else { '' }
  if ([string]::IsNullOrWhiteSpace($runtimeSelectorValue) -or $runtimeSelectorValue -in @('""', "''")) {
    throw '[zuri] A custom -EnvironmentFile must set ZURI_WEB_ENV_FILE to the intended container runtime env file.'
  }

  $dockerSelector = [regex]::Match($environmentFileText, '(?m)^\s*(?:export\s+)?ZURI_WEB_DOCKER_ENV_FILE\s*=\s*(.*)$')
  $dockerSelectorValue = if ($dockerSelector.Success) { Get-ComposePathSelector $dockerSelector.Groups[1].Value 'ZURI_WEB_DOCKER_ENV_FILE' } else { '' }
  $dockerRuntimeEnvExists = Test-Path -LiteralPath (Join-Path $root '.env.docker') -PathType Leaf
  if ($dockerSelector.Success -and [string]::IsNullOrWhiteSpace($dockerSelectorValue)) {
    throw '[zuri] ZURI_WEB_DOCKER_ENV_FILE cannot be an empty quoted value in a custom -EnvironmentFile.'
  }
  if ($dockerRuntimeEnvExists -and (-not $dockerSelector.Success -or [string]::IsNullOrWhiteSpace($dockerSelectorValue))) {
    throw '[zuri] A custom -EnvironmentFile must set ZURI_WEB_DOCKER_ENV_FILE explicitly when apps/server/.env.docker exists.'
  }
  $expectedDockerSelectorValue = if ($dockerSelector.Success) { $dockerSelectorValue } elseif ($dockerRuntimeEnvExists) { '.env.docker' } else { '' }

  $knowledgeSelector = [regex]::Match($environmentFileText, '(?m)^\s*(?:export\s+)?ZURI_KNOWLEDGE_ENV_FILE\s*=\s*(.*)$')
  $knowledgeSelectorValue = if ($knowledgeSelector.Success) { Get-ComposePathSelector $knowledgeSelector.Groups[1].Value 'ZURI_KNOWLEDGE_ENV_FILE' } else { '' }
  $defaultKnowledgeEnvironmentPath = Join-Path $root '.env.knowledge'
  $defaultKnowledgeEnvironmentExists = Test-Path -LiteralPath $defaultKnowledgeEnvironmentPath -PathType Leaf
  if ($knowledgeSelector.Success -and [string]::IsNullOrWhiteSpace($knowledgeSelectorValue)) {
    throw '[zuri] ZURI_KNOWLEDGE_ENV_FILE cannot be an empty quoted value in a custom -EnvironmentFile.'
  }
  if ($defaultKnowledgeEnvironmentExists -and (-not $knowledgeSelector.Success -or [string]::IsNullOrWhiteSpace($knowledgeSelectorValue))) {
    throw '[zuri] A custom -EnvironmentFile must set a separate ZURI_KNOWLEDGE_ENV_FILE when apps/server/.env.knowledge exists.'
  }
  if ($defaultKnowledgeEnvironmentExists) {
    $selectedKnowledgeEnvironmentPath = if ([System.IO.Path]::IsPathRooted($knowledgeSelectorValue)) {
      $knowledgeSelectorValue
    } else {
      Join-Path $root $knowledgeSelectorValue
    }
    if (-not (Test-Path -LiteralPath $selectedKnowledgeEnvironmentPath -PathType Leaf)) {
      throw '[zuri] ZURI_KNOWLEDGE_ENV_FILE must resolve to an existing file when apps/server/.env.knowledge exists.'
    }
    $defaultKnowledgeResolved = (Resolve-Path -LiteralPath $defaultKnowledgeEnvironmentPath).ProviderPath
    $selectedKnowledgeResolved = (Resolve-Path -LiteralPath $selectedKnowledgeEnvironmentPath).ProviderPath
    if ([string]::Equals($defaultKnowledgeResolved, $selectedKnowledgeResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw '[zuri] A custom -EnvironmentFile cannot reuse apps/server/.env.knowledge; select a separate per-project knowledge env file.'
    }
  }
  $expectedKnowledgeSelectorValue = if ($knowledgeSelector.Success) { $knowledgeSelectorValue } elseif ($defaultKnowledgeEnvironmentExists) { '.env.knowledge' } else { '' }
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
  if ((Test-Path -LiteralPath (Join-Path $root '.env.docker') -PathType Leaf) -and
      [string]::IsNullOrWhiteSpace((Get-ResolvedComposeValue 'ZURI_WEB_DOCKER_ENV_FILE'))) {
    throw '[zuri] A custom -EnvironmentFile resolved ZURI_WEB_DOCKER_ENV_FILE to empty, which would load apps/server/.env.docker by default.'
  }
  if ($runtimeEnvironmentFile -ne $runtimeSelectorValue) {
    throw '[zuri] The process environment overrides ZURI_WEB_ENV_FILE from the selected custom -EnvironmentFile; remove the conflicting override.'
  }
  if ((Get-ResolvedComposeValue 'ZURI_WEB_DOCKER_ENV_FILE') -ne $expectedDockerSelectorValue) {
    throw '[zuri] The process environment overrides ZURI_WEB_DOCKER_ENV_FILE from the selected custom -EnvironmentFile; remove the conflicting override.'
  }
  $resolvedKnowledgeEnvironmentFile = Get-ResolvedComposeValue 'ZURI_KNOWLEDGE_ENV_FILE'
  if ($resolvedKnowledgeEnvironmentFile -ne $expectedKnowledgeSelectorValue) {
    throw '[zuri] The process environment overrides ZURI_KNOWLEDGE_ENV_FILE from the selected custom -EnvironmentFile; remove the conflicting override.'
  }
  if (-not [string]::IsNullOrWhiteSpace($resolvedKnowledgeEnvironmentFile) -and
      -not (Test-Path -LiteralPath (Resolve-ServerPath $resolvedKnowledgeEnvironmentFile) -PathType Leaf)) {
    throw '[zuri] ZURI_KNOWLEDGE_ENV_FILE does not resolve to an existing file.'
  }
}

function Test-ImageTagIsProjectScoped([string]$image, [string]$projectName) {
  if ([string]::IsNullOrWhiteSpace($image) -or [string]::IsNullOrWhiteSpace($projectName)) { return $false }
  $reference = ($image -split '@', 2)[0]
  $separator = $reference.LastIndexOf(':')
  if ($separator -le $reference.LastIndexOf('/')) { return $false }
  $tag = $reference.Substring($separator + 1)
  return $tag.EndsWith("-$projectName", [System.StringComparison]::OrdinalIgnoreCase)
}

if ($ProjectName) {
  $webImage = Get-ResolvedComposeValue 'ZURI_WEB_IMAGE'
  if (-not (Test-ImageTagIsProjectScoped $webImage $ProjectName)) {
    throw "[zuri] ZURI_WEB_IMAGE must have a Docker tag ending in '-$ProjectName' so named Compose projects cannot share or retag one another's image."
  }
  if ($activeProfiles -contains 'local-db') {
    $toolsImage = Get-ResolvedComposeValue 'ZURI_TOOLS_IMAGE'
    if (-not (Test-ImageTagIsProjectScoped $toolsImage $ProjectName)) {
      throw "[zuri] ZURI_TOOLS_IMAGE must have a Docker tag ending in '-$ProjectName' so named local-db projects cannot share or retag one another's image."
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
