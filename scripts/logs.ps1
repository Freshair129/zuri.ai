<#
.SYNOPSIS
  Follow the Docker Compose logs for the zuri-ai stack (all services, or one).

.EXAMPLE
  .\scripts\logs.ps1            # everything
  .\scripts\logs.ps1 web        # only the app
  .\scripts\logs.ps1 ngrok -Tail 50
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Service = '',
  [int]$Tail = 200
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($Service) {
  docker compose logs -f --tail $Tail $Service
} else {
  docker compose logs -f --tail $Tail
}
exit $LASTEXITCODE
