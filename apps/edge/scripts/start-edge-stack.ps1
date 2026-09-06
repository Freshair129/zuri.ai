# Bring the edge runtime up, in dependency order, without disturbing anything else.
#
# ADR-061: this launcher starts compute-only by default. Zuri Server owns LINE ingress
# and delivery. Use -TransportOwner LEGACY_EDGE only during the documented cutover.
# This script does not stop an existing legacy webhook or change provider configuration.
#
# Deliberately NOT modelled on start-edge-device.bat, which belongs to the old machine: it hardcodes
# that machine's user and D: drive, and it opens with `Get-Process node | Stop-Process -Force`,
# which here would kill the RAG service, editors' language servers, and every other node process
# that happens to be running. Nothing below kills anything it did not start.
#
# Idempotent: every service is health-checked first and skipped if it already answers, so this is
# safe to run repeatedly, at logon, or by hand while the stack is up.
#
#   Install (no admin needed — runs at logon for this user):
#     powershell -ExecutionPolicy Bypass -File scripts\start-edge-stack.ps1 -Install
#   Run now:
#     powershell -ExecutionPolicy Bypass -File scripts\start-edge-stack.ps1
#   Remove the scheduled task:
#     powershell -ExecutionPolicy Bypass -File scripts\start-edge-stack.ps1 -Uninstall
#
# Windows PowerShell 5.1 — no ternary, no `??`, no `&&`.

[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [ValidateSet('SERVER', 'LEGACY_EDGE')]
  [string]$TransportOwner = 'SERVER',
  # Seconds to wait for the embed sidecar, which loads a model and is by far the slowest to answer.
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
$env:ZURI_LINE_TRANSPORT_OWNER = $TransportOwner
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TaskName = 'ZuriEdgeStack'
$LogDir   = Join-Path $RepoRoot 'state\startup-logs'

function Write-Step { param([string]$Text) Write-Host "[edge-stack] $Text" }

# A service is "up" when its endpoint answers, not when a process with the right name exists — a
# half-dead process still holding the port is exactly the failure this needs to notice.
function Test-Endpoint {
  param([string]$Url, [int]$Timeout = 4, [switch]$RequireOk)
  try {
    Invoke-WebRequest -Uri $Url -TimeoutSec $Timeout -UseBasicParsing | Out-Null
    return $true
  } catch {
    # Two different questions, and they want different answers.
    #
    # "Is something already holding this port?" is answered by any reply at all, including a 5xx —
    # and it has to be, because starting a second RAG service would fight the first over the
    # GenesisBlock store's exclusive lock.
    #
    # "Did the thing I just started come up?" is not. The RAG service answers /health with 503
    # while its store or its embedder is not ready, so treating that as success let the webhook
    # start in front of a catalogue that could not answer yet. -RequireOk asks the stricter one.
    if ($RequireOk) { return $false }
    return ($null -ne $_.Exception.Response)
  }
}

function Wait-Endpoint {
  param([string]$Url, [int]$Timeout, [string]$Label, [switch]$RequireOk)
  $deadline = (Get-Date).AddSeconds($Timeout)
  while ((Get-Date) -lt $deadline) {
    if (Test-Endpoint -Url $Url -RequireOk:$RequireOk) { Write-Step "$Label is up"; return $true }
    Start-Sleep -Seconds 2
  }
  Write-Step "$Label did NOT come up within $Timeout s"
  return $false
}

function Start-EdgeService {
  param(
    [string]$Label,
    [string]$HealthUrl,
    [string]$Exe,
    [string[]]$ExeArgs,
    [int]$WaitSec,
    [switch]$RequireOk
  )
  if (Test-Endpoint -Url $HealthUrl) { Write-Step "$Label already up — leaving it alone"; return $true }
  Write-Step "starting $Label"
  $log = Join-Path $LogDir "$Label.log"
  # Redirected to files rather than inherited: at logon there is no console to inherit, and a crash
  # three days from now needs a record that outlived the session that started it.
  # Keep one generation of logs. -RedirectStandardOutput truncates, and the restart that follows a
  # crash is the moment the crash's own output gets destroyed — which is not hypothetical: the
  # operator key printed once at first start was lost to exactly this.
  foreach ($f in @($log, "$log.err")) {
    if (Test-Path -LiteralPath $f) { Move-Item -LiteralPath $f -Destination "$f.prev" -Force }
  }
  Start-Process -FilePath $Exe -ArgumentList $ExeArgs -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null
  return (Wait-Endpoint -Url $HealthUrl -Timeout $WaitSec -Label $Label -RequireOk:$RequireOk)
}

if ($Install) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -TransportOwner $TransportOwner" `
    -WorkingDirectory $RepoRoot
  # At logon rather than at startup: a startup trigger needs administrator rights to register, and
  # this stack has no reason to run before someone is signed in. If it ever has to survive an
  # unattended reboot, that is a Windows service and a different conversation.
  $trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Starts the optional Zuri compute worker and local RAG dependencies at logon.' `
    -Force | Out-Null
  Write-Step "registered scheduled task '$TaskName' (at logon, $env:USERNAME)"
  exit 0
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Step "removed scheduled task '$TaskName'"
  exit 0
}

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $RepoRoot
$ok = $true

# The webhook runs from dist/, so a checkout that has never been built has nothing to start. Build
# only when it is missing: rebuilding on every logon would add a minute to every boot and turn a
# transient compile error into a dead webhook.
if (-not (Test-Path (Join-Path $RepoRoot 'dist\cli\index.js'))) {
  Write-Step 'dist/ is missing — building once'
  # Through cmd rather than the PowerShell pipeline. Under $ErrorActionPreference='Stop', the first
  # stderr line from a native command becomes a terminating error — and `npm run` writes its banner
  # to stderr unconditionally, so the pipeline form aborted the script on the one path this branch
  # exists for, before the friendly message below could ever run.
  $buildLog = Join-Path $LogDir 'build.log'
  & cmd /c "npm run build > `"$buildLog`" 2>&1"
  if (-not (Test-Path (Join-Path $RepoRoot 'dist\cli\index.js'))) {
    Write-Step 'build FAILED — see state\startup-logs\build.log'
    exit 1
  }
}

# 1. Ollama. Never started here: it autostarts from its own shortcut in the Startup folder, and a
#    second copy would fight the first over the model files.
#
#    It is waited for rather than probed once, because that shortcut fires at logon and so does this
#    task — a single instantaneous check races it and reports a healthy Ollama as missing. Nothing
#    below actually needs it (the webhook reaches for a model per request, not at startup), so this
#    never fails the stack; the wait exists only to keep the log honest.
if (Wait-Endpoint -Url 'http://127.0.0.1:11434/api/tags' -Timeout 90 -Label 'ollama') {
  # Wait-Endpoint already logged it.
} else {
  Write-Step 'ollama did not appear — answers will fall back to the pattern reader until it does'
}

# 2. Embed sidecar. First, because the RAG service embeds queries through it.
if (-not (Start-EdgeService -Label 'embed-sidecar' -HealthUrl 'http://127.0.0.1:8891/health' `
    -Exe 'py' -ExeArgs @('-3', 'scripts\embed-sidecar.py') -WaitSec $TimeoutSec)) { $ok = $false }

# 3. RAG service. Opens the GenesisBlock store and holds its exclusive lock — even readOnly — so
#    exactly one of these may run. The health check above is what keeps that true.
if (-not (Start-EdgeService -Label 'rag-service' -HealthUrl 'http://127.0.0.1:8888/health' `
    -Exe 'node' -ExeArgs @('--import', 'tsx', 'scripts\rag-serve.ts') -WaitSec 60)) { $ok = $false }

# 4. Compute worker is the default. Only an explicit migration mode opens LINE ingress.
if ($ok -and $TransportOwner -eq 'LEGACY_EDGE') {
  if (-not (Start-EdgeService -Label 'webhook' -HealthUrl 'http://127.0.0.1:8787/' `
      -Exe 'node' -ExeArgs @('dist\cli\index.js', 'webhook', 'serve') -WaitSec 60)) { $ok = $false }
} elseif ($ok) {
  # No HTTP listener exists in compute-only mode. Match our absolute entry point before
  # reusing a PID, so PID reuse cannot make an unrelated Node process look like this worker.
  $entry = Join-Path $RepoRoot 'dist\cli\index.js'
  $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($entry) -and $_.CommandLine.Contains('conversation serve')
  }
  if ($existing) { Write-Step 'conversation worker process already running; leaving it alone' }
  else {
    $log = Join-Path $LogDir 'conversation.log'
    $worker = Start-Process -FilePath 'node' -ArgumentList @("`"$entry`"", 'conversation', 'serve') `
      -WorkingDirectory $RepoRoot -WindowStyle Hidden -RedirectStandardOutput $log `
      -RedirectStandardError "$log.err" -PassThru
    Start-Sleep -Seconds 2
    if ($worker.HasExited) { Write-Step 'conversation worker exited; see conversation.log.err'; $ok = $false }
    else { Write-Step 'conversation worker started; verify claim and heartbeat in the Zuri console' }
  }
} else {
  Write-Step 'NOT starting the worker: the catalogue behind it did not come up'
}

if ($ok) {
  Write-Step 'stack is up'
  exit 0
} else {
  Write-Step 'stack came up INCOMPLETE — see state\startup-logs'
  exit 1
}
