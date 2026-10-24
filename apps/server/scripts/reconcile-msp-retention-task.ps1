# @req FR-230 — explicit operator recovery, never automatic gate clearing.
# @spec SEC-031, ADR-091
# @tested tests/unit/msp-retention-scheduler.test.js
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$TargetFile,
  [Parameter(Mandatory = $true)][string]$ActionScript,
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$StoppedContainerId
)
$ErrorActionPreference = 'Stop'
if ($RunId -notmatch '^[0-9a-f-]{36}$' -or $StoppedContainerId -notmatch '^[0-9a-f]{64}$') { throw 'MSP_RETENTION_RECOVERY_ARGUMENT_INVALID' }
$dockerPath = (Get-Command docker -ErrorAction Stop).Source
$shellPath = (Get-Process -Id $PID).Path
$target = Get-Content -LiteralPath $TargetFile -Raw | ConvertFrom-Json
if ($target.ReconcileScriptSha256 -ne (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'MSP_RETENTION_RECOVERY_SCRIPT_MISMATCH' }
& $shellPath -NoProfile -NonInteractive -File $ActionScript -TargetFile $TargetFile -DockerExecutable $dockerPath -CheckOnly
if ($LASTEXITCODE) { throw 'MSP_RETENTION_RECOVERY_TARGET_INVALID' }
$oldJson = & $dockerPath inspect $StoppedContainerId 2>$null
if ($LASTEXITCODE) { throw 'MSP_RETENTION_OLD_CONTAINER_NOT_VERIFIED' }
$old = @($oldJson | ConvertFrom-Json)
if ($old.Count -ne 1 -or $old[0].Id -ne $StoppedContainerId -or $old[0].State.Running -or $old[0].State.Pid -ne 0 -or
    $old[0].Config.Labels.'com.docker.compose.project' -ne $target.Project -or $old[0].Config.Labels.'com.docker.compose.service' -ne 'web') {
  throw 'MSP_RETENTION_OLD_CONTAINER_NOT_STOPPED'
}
$oldMount = @($old[0].Mounts | Where-Object { $_.Destination -eq '/var/lib/zuri-ki17/state' -and $_.Name -eq $target.StateVolume })
if ($oldMount.Count -ne 1) { throw 'MSP_RETENTION_OLD_CONTAINER_STATE_MISMATCH' }
$currentJson = & $dockerPath inspect $target.ContainerName 2>$null
if ($LASTEXITCODE) { throw 'MSP_RETENTION_REPLACEMENT_MISSING' }
$current = @($currentJson | ConvertFrom-Json)[0]
if ($current.Id -eq $StoppedContainerId) { throw 'MSP_RETENTION_REPLACEMENT_REQUIRED' }
# Stop/inspect are deliberately separate human maintenance steps. This command
# never stops containers and never deletes data; it attests an already stopped PID.
if ($PSCmdlet.ShouldProcess($RunId, 'Record stopped-container MSP retention reconciliation')) {
  if ($target.RecoverySignerScriptSha256 -ne (Get-FileHash -LiteralPath $target.RecoverySignerScript -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'MSP_RETENTION_RECOVERY_SIGNER_MISMATCH' }
  $allowedSids = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
  foreach ($rule in (Get-Acl -LiteralPath $target.RecoveryPrivateKeyFile).Access) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids) {
      throw 'MSP_RETENTION_RECOVERY_KEY_ACL_INVALID'
    }
  }
  $issuedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $claims = [ordered]@{ runId = $RunId; stoppedContainerId = $StoppedContainerId; currentContainerId = $current.Id;
    project = $target.Project; appRevision = $target.AppRevision; issuedAt = $issuedAt; expiresAt = $issuedAt + 60000; nonce = [guid]::NewGuid().ToString() }
  $claimsJson = $claims | ConvertTo-Json -Compress
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $proofJson = $claimsJson | & $nodePath $target.RecoverySignerScript $target.RecoveryPrivateKeyFile
  if ($LASTEXITCODE) { throw 'MSP_RETENTION_RECOVERY_SIGNING_FAILED' }
  $proof = $proofJson | ConvertFrom-Json
  $body = @{ reconcileRunId = $RunId; stoppedContainerId = $StoppedContainerId; proof = $proof } | ConvertTo-Json -Depth 5 -Compress
  $body | & $dockerPath exec -i $current.Id node scripts/server-msp-retention-reconcile.mjs
  exit $LASTEXITCODE
}
