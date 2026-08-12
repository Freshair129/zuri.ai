@echo off
REM ============================================================
REM  Zuri V2 - Project Manager  (server + UI, one Next.js app)
REM  Double-click to run, or:  run.bat
REM  Serves API + UI on http://localhost:3100
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo [zuri] Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 goto :fail
)

echo [zuri] Syncing database schema ^(non-destructive^)...
call npm run db:push
if errorlevel 1 goto :fail

echo [zuri] Seeding demo data ^(idempotent^)...
call npm run db:seed

echo [zuri] Opening http://localhost:3100/overview
start "" "http://localhost:3100/overview"

echo [zuri] Starting server + UI on port 3100  ^(Ctrl+C to stop^)...
call npm run dev -- -p 3100
goto :eof

:fail
echo.
echo [zuri] Startup failed - see the errors above.
pause
exit /b 1
