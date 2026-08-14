@echo off
REM ============================================================
REM  Zuri V2 - Project Manager  (server + UI, one Next.js app)
REM  Double-click to run, or:  run.bat
REM  Serves API + UI on http://localhost:3100
REM ============================================================
setlocal
cd /d "%~dp0"

REM Prisma 5.22's Windows schema engine needs a supported Rust log mode
REM under the repository's Node 24 toolchain (warn can terminate bootstrap).
set "RUST_LOG=info"
REM Explicit local-only demo session capability (ADR-017 / FR-046).
set "ZURI_LOCAL_DEMO_AUTH=1"
REM @req FR-046 - clean-checkout local demo startup owns a SQLite datasource.
REM @spec ADR-017, SDD-024, SEC-008 - caller-provided database authority remains authoritative.
REM @tested tests/unit/run-bat-database-bootstrap.test.js
if not defined DATABASE_URL set "DATABASE_URL=file:./dev.db"

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
