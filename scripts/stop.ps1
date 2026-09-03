<#
.SYNOPSIS
  Stop the zuri-ai Docker Compose stack. Data volumes are kept.

.PARAMETER RemoveVolumes
  Also delete the named volumes (the bundled Postgres data). Destructive — only
  meaningful with the local-db profile, and never needed for an ordinary restart.
#>
[CmdletBinding()]
param(
  [switch]$RemoveVolumes
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($RemoveVolumes) {
  Write-Warning '[zuri] Removing volumes: the bundled Postgres data (db-data) will be deleted.'
  docker compose --profile local-db down --remove-orphans --volumes
} else {
  docker compose --profile local-db down --remove-orphans
}
exit $LASTEXITCODE
