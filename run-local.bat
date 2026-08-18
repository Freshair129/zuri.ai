@echo off
REM ============================================================
REM  Zuri V2 - Project Manager local SQLite runner
REM  Double-click to run, or: run-local.bat
REM  Serves the offline/demo app on http://localhost:3100
REM ============================================================
setlocal
cd /d "%~dp0"

REM Prisma 5.22's Windows schema engine needs a supported Rust log mode
REM under the repository's Node 24 toolchain (warn can terminate bootstrap).
set "RUST_LOG=info"
REM Explicit local-only demo session capability (ADR-017 / FR-046).
set "ZURI_LOCAL_DEMO_AUTH=1"
REM @req FR-046 - local demo startup owns a SQLite datasource.
REM @spec ADR-017, ADR-035, SEC-008 - this runner is the explicit offline path.
REM @tested tests/unit/postgres-runtime-bootstrap.test.js
set "DATABASE_URL=file:./dev.db"

if not exist "node_modules" (
  echo [zuri] Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 goto :fail
)

echo [zuri] Syncing local SQLite schema ^(non-destructive^)...
call npm run db:push
if errorlevel 1 goto :fail

echo [zuri] Seeding local demo data ^(idempotent^)...
call npm run db:seed
if errorlevel 1 goto :fail

echo [zuri] Opening http://localhost:3100/overview
start "" "http://localhost:3100/overview"

echo [zuri] Starting local server + UI on port 3100  ^(Ctrl+C to stop^)...
call npm run dev -- -p 3100
goto :eof

:fail
echo.
echo [zuri] Local startup failed - see the errors above.
pause
exit /b 1
