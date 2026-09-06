<#
.SYNOPSIS
  Print the public HTTPS URL the ngrok container is serving.

.DESCRIPTION
  Asks ngrok's local inspection API (published on 127.0.0.1:4040 by
  docker-compose.yml) for the active tunnel. With NGROK_DOMAIN set this is the
  static domain; otherwise it is the temporary URL ngrok assigned on this start.
  Retries for a short while because ngrok starts only after `web` is healthy.
#>
[CmdletBinding()]
param(
  [int]$Port = 4040,
  [int]$Attempts = 20,
  [int]$DelaySeconds = 3
)

$ErrorActionPreference = 'Stop'
$api = "http://127.0.0.1:$Port/api/tunnels"

for ($i = 1; $i -le $Attempts; $i++) {
  try {
    $tunnels = Invoke-RestMethod -Uri $api -TimeoutSec 5
    $https = @($tunnels.tunnels | Where-Object { $_.public_url -like 'https://*' })
    if ($https.Count -gt 0) {
      $url = $https[0].public_url
      Write-Host "[zuri] public URL : $url"
      Write-Host "[zuri] LINE webhook: $url/api/agent/line-webhook"
      Write-Host "[zuri] health      : $url/api/health"
      exit 0
    }
  }
  catch {
    # ngrok not up yet (it waits for web's health check) — keep polling.
  }
  Start-Sleep -Seconds $DelaySeconds
}

Write-Warning "[zuri] ngrok has not reported a tunnel on 127.0.0.1:$Port yet. Check: docker compose logs ngrok"
exit 1
