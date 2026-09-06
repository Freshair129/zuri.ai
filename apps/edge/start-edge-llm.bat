@echo off
setlocal enabledelayedexpansion

REM 1. Set PATH for GoVibe Node.js toolchain
set "PATH=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64;%PATH%"

cd /d "D:\workspace\zuri-edge-llm"

echo =====================================================================
echo           ZURI LOCAL EDGE RUNTIME + GENESISBLOCK RAG
echo =====================================================================
echo.
echo [*] Working Directory: %CD%
echo [*] Checking Node.js runtime...
node -v
if errorlevel 1 (
    echo [!] Error: Node.js 20+ required.
    pause
    exit /b 1
)

REM 2. Clear Port 8787 cleanly via PowerShell
echo [*] Clearing Port 8787 and old instances...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID } | Stop-Process -Force -ErrorAction SilentlyContinue; Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

REM 3. Compile TypeScript
echo [*] Compiling TypeScript source...
call npm run build
if errorlevel 1 (
    echo [!] Build failed.
    pause
    exit /b 1
)

REM 4. Send Heartbeat to Zuri Cloud Console (ADR-058: no fixed platform URL any more — set
REM    ZURI_CLOUD_HEARTBEAT_URL in .env to your own deployment's origin, or this step is skipped)
set "ZURI_CLOUD_HEARTBEAT_URL="
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b "ZURI_CLOUD_HEARTBEAT_URL=" .env`) do set "ZURI_CLOUD_HEARTBEAT_URL=%%B"
)
if defined ZURI_CLOUD_HEARTBEAT_URL (
    echo [*] Sending Initial Heartbeat to Zuri Cloud Console...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $res = Invoke-RestMethod -Uri '%ZURI_CLOUD_HEARTBEAT_URL%' -Method POST -Body (@{ deviceId='DEV-SMARTGIFT-PRIMARY'; engine='GenesisBlock + Luna 5.6 (Codex CLI)'; model='luna-5.6'; status='online' } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 10; Write-Host '    -> Heartbeat Verified:' $res.success } catch { Write-Host '    -> Heartbeat Notice:' $_.Exception.Message }"
) else (
    echo [*] ZURI_CLOUD_HEARTBEAT_URL not set in .env — skipping cloud heartbeat.
)

echo.
echo =====================================================================
echo   [OK] RUNTIME ACTIVE: Ready for LINE Webhooks
echo   - Local RAG: GenesisBlock Graph Engine (G:\GenesisBlock_Dev)
echo   - Model: Codex CLI / Luna 5.6 (Zero Token Cost Plan)
echo   - LINE Webhook: http://localhost:8787/webhook/line
echo =====================================================================
echo.

REM 5. Launch Webhook Serve Daemon
node dist/cli/index.js webhook serve

if errorlevel 1 (
    echo.
    echo [!] Server stopped.
    pause
)
