# @req FR-230 — exact-target host action for nightly MSP maintenance.
# @spec SEC-031, ADR-091
# @tested tests/unit/msp-retention-scheduler.test.js
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TargetFile,
  [Parameter(Mandatory = $true)][string]$DockerExecutable,
  [switch]$CheckOnly,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$logFile = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($TargetFile))) 'msp-retention-runs.jsonl'
try {
  $target = Get-Content -LiteralPath $TargetFile -Raw | ConvertFrom-Json
  if ($target.SchemaVersion -ne 1 -or $target.Project -notmatch '^[a-z0-9][a-z0-9_-]{1,63}$' -or
      $target.ContainerName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$' -or
      $target.AppRevision -notmatch '^[0-9a-f]{40}$' -or $target.TenantScopeHash -notmatch '^[0-9a-f]{64}$' -or
      $target.DatabaseIdentityHash -notmatch '^[0-9a-f]{64}$' -or
      $target.DatabasePoolMode -notin @('session', 'transaction') -or
      $target.StateVolume -ne ($target.Project + '_ki17-state') -or
      $target.DatabaseName -notmatch '^zuri_[a-z0-9_]+$' -or
      $target.ScriptSha256 -ne (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()) {
    throw 'MSP_RETENTION_TARGET_INVALID'
  }
  $output = & $DockerExecutable inspect $target.ContainerName 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'MSP_RETENTION_INSPECT_FAILED' }
  $containers = @($output | ConvertFrom-Json)
  if ($containers.Count -ne 1) { throw 'MSP_RETENTION_TARGET_AMBIGUOUS' }
  $container = $containers[0]
  if ($container.Id -notmatch '^[0-9a-f]{64}$' -or $container.Config.Hostname -ne $container.Id.Substring(0, 12)) { throw 'MSP_RETENTION_CONTAINER_IDENTITY_INVALID' }
  $labels = $container.Config.Labels
  if ($labels.'com.docker.compose.project' -ne $target.Project -or $labels.'com.docker.compose.service' -ne 'web' -or
      $labels.'org.opencontainers.image.revision' -ne $target.AppRevision -or $container.State.Status -ne 'running' -or
      $container.State.Health.Status -ne 'healthy') { throw 'MSP_RETENTION_RUNTIME_MISMATCH' }
  $mount = @($container.Mounts | Where-Object { $_.Destination -eq '/var/lib/zuri-ki17/state' })
  if ($mount.Count -ne 1 -or $mount[0].Type -ne 'volume' -or $mount[0].Name -ne $target.StateVolume -or -not $mount[0].RW) {
    throw 'MSP_RETENTION_STATE_MISMATCH'
  }
  $runtimeEnv = @{}
  foreach ($entry in $container.Config.Env) { $parts = $entry.Split('=', 2); $runtimeEnv[$parts[0]] = $parts[1] }
  $dbUrl = $null
  $selectedDbValue = $null
  foreach ($name in @('POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL', 'DATABASE_URL')) {
    if ($runtimeEnv[$name] -match '^postgres(?:ql)?://') { $selectedDbValue = $runtimeEnv[$name]; $dbUrl = [uri]$selectedDbValue; break }
  }
  $poolMode = ([string]$runtimeEnv['ZURI_DB_POOL_MODE']).Trim().ToLowerInvariant()
  if ($poolMode -notin @('session', 'transaction')) { if ($runtimeEnv['VERCEL']) { $poolMode = 'transaction' } else { $poolMode = 'session' } }
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $scopeHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$runtimeEnv['ZURI_MSP_RETENTION_TENANTS']))).Replace('-', '').ToLowerInvariant()
    $databaseHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$selectedDbValue))).Replace('-', '').ToLowerInvariant()
  }
  finally { $hasher.Dispose() }
  if (-not $dbUrl -or $dbUrl.AbsolutePath -ne ('/' + $target.DatabaseName) -or
      $scopeHash -ne $target.TenantScopeHash -or $databaseHash -ne $target.DatabaseIdentityHash -or $poolMode -ne $target.DatabasePoolMode -or $runtimeEnv['MSP_DB_PATH'] -ne '/var/lib/zuri-ki17/state/msp.sqlite' -or
      ([string]$runtimeEnv['ZURI_MSP_RETENTION_SWEEP_TOKEN']).Length -lt 32) { throw 'MSP_RETENTION_CONFIGURATION_MISMATCH' }
  if ($CheckOnly) { Write-Output '{"event":"msp.retention-target.check","ok":true}'; exit 0 }
  # Resolve the immutable ID once; a recreated/repointed name cannot redirect exec.
  $workerArgs = @('exec', $container.Id, 'node', 'scripts/server-msp-retention-worker.mjs')
  if ($DryRun) { $workerArgs += '--dry-run' }
  $workerOutput = & $DockerExecutable @workerArgs 2>$null
  $workerExit = $LASTEXITCODE
  # Only the worker's fixed JSON projection is retained; never raw stderr/env.
  $sawResult = $false
  foreach ($line in $workerOutput) {
    try {
      $value = $line | ConvertFrom-Json
      if ($value.event -eq 'msp.retention-sweep.tick' -and ($null -eq $value.runId -or $value.runId -match '^[0-9a-f-]{36}$')) {
        $outcomes = @($value.tenantOutcomes | Where-Object { $_ -in @('COMPLETE', 'DRY_RUN', 'DEFERRED', 'PARTIAL', 'UNKNOWN', 'FAILED', 'INVALID') })
        $safe = @{ event = 'msp.retention-sweep.tick'; ok = ($value.ok -eq $true); status = $value.status; runId = $value.runId; tenantOutcomes = $outcomes; observedAt = [DateTimeOffset]::UtcNow.ToString('o') }
        $json = $safe | ConvertTo-Json -Compress
        Add-Content -LiteralPath $logFile -Value $json
        $sawResult = $true
        Write-Output $json
      }
    } catch { }
  }
  if (-not $sawResult) { throw 'MSP_RETENTION_WORKER_RESULT_MISSING' }
  exit $workerExit
} catch {
  $failure = '{"event":"msp.retention-task.failed","ok":false,"error":"TARGET_OR_EXECUTION_FAILED"}'
  try { Add-Content -LiteralPath $logFile -Value $failure } catch { }
  Write-Output $failure
  exit 1
}
