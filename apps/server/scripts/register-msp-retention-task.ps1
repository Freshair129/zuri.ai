# @req FR-230 — daily 03:00 host schedule; never a second polling service.
# @spec SEC-031, ADR-091
# @tested tests/unit/msp-retention-scheduler.test.js
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$TargetFile,
  [Parameter(Mandatory = $true)][string]$ActionScript,
  [Parameter(Mandatory = $true)][string]$TaskName,
  [datetime]$At = [datetime]::Parse('03:00')
)
$ErrorActionPreference = 'Stop'
$targetPath = (Resolve-Path -LiteralPath $TargetFile).Path
$actionPath = (Resolve-Path -LiteralPath $ActionScript).Path
$dockerPath = (Get-Command docker -ErrorAction Stop).Source
$shellPath = (Get-Process -Id $PID).Path
foreach ($path in @($targetPath, $actionPath, $dockerPath, $shellPath)) {
  if (-not [IO.Path]::IsPathRooted($path) -or $path -match '["\r\n]') { throw 'MSP_RETENTION_TASK_PATH_INVALID' }
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'MSP_RETENTION_TASK_EXISTS' }
& $shellPath -NoProfile -NonInteractive -File $actionPath -TargetFile $targetPath -DockerExecutable $dockerPath -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'MSP_RETENTION_TASK_TARGET_CHECK_FAILED' }
$action = New-ScheduledTaskAction -Execute $shellPath -Argument "-NoProfile -NonInteractive -File `"$actionPath`" -TargetFile `"$targetPath`" -DockerExecutable `"$dockerPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
# -WhatIf leaves the task registry unchanged. Interactive mode requires a logged-in user.
if ($PSCmdlet.ShouldProcess($TaskName, 'Register daily MSP retention')) {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'FR-230 MSP retention; exact project/revision/database/volume fence. Memory activation is separate.' | Out-Null
  Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object TaskName, NextRunTime, LastRunTime, LastTaskResult
}
