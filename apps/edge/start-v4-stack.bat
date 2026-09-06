@echo off
setlocal
REM =====================================================================
REM  ZURI CATALOG GRAPH v4 - full stack launcher (safe: kills only own ports)
REM  1) embed sidecar :8891   2) rag-service :8888   3) LINE agent :8787
REM  Run from D:\workspace\zuri-edge-catalog-p4 (branch feat/catalog-graph-v4)
REM =====================================================================
set "PATH=C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64;%PATH%"
cd /d "%~dp0"

echo [*] Freeing ports 8787/8888/8891 (only their owners, never all node)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "8787,8888,8891 | ForEach-Object { Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue } | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo [*] Building zuri-edge-catalog-p4 (rag-service reads dist/)...
call npm run build
if errorlevel 1 ( echo [!] Build failed & pause & exit /b 1 )

echo [*] Starting embed sidecar :8891 ...
start "v4-embed-sidecar" /min cmd /c "py -3 scripts\embed-sidecar.py"
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try { irm http://127.0.0.1:8891/health -TimeoutSec 2 ^| Out-Null; exit 0 } catch { Start-Sleep 2 } }; exit 1"
if errorlevel 1 ( echo [!] Sidecar did not come up & pause & exit /b 1 )

echo [*] Starting rag-service :8888 ...
start "v4-rag-service" /min cmd /c "cd /d D:\workspace\zuri-rag-service && set ZURI_DATA_ROOT=D:\workspace\zuri-edge-device\data&& set EMBED_URL=http://127.0.0.1:8891&& set RAG_PORT=8888&& npx tsx src/server.ts"
powershell -NoProfile -Command "for($i=0;$i -lt 45;$i++){ try { $h = irm http://127.0.0.1:8888/health -TimeoutSec 2; if($h.ok){ exit 0 } } catch {}; Start-Sleep 2 }; exit 1"
if errorlevel 1 ( echo [!] rag-service /health not ok & pause & exit /b 1 )

echo [*] Starting LINE agent (webhook :8787) from THIS worktree (v4 branch)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:GENESIS_RAG_API_URL='http://localhost:8888'; Start-Process -FilePath 'node' -ArgumentList 'dist\cli\index.js','webhook','serve' -WorkingDirectory '%~dp0' -WindowStyle Minimized"

echo.
echo [OK] v4 stack: sidecar :8891, rag-service :8888 (store CURRENT), LINE webhook :8787
endlocal
