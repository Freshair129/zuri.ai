@echo off
REM ============================================================
REM  Zuri V2 - Project Manager  (server + UI, one Next.js app)
REM  Double-click to run, or:  run.bat
REM  Serves API + UI on http://localhost:3100
REM ============================================================
setlocal
cd /d "%~dp0"

REM @req FR-054 - inject the dedicated Supabase URL into this process tree only.
REM @spec SDD-027, SEC-011 - credential remains in Windows Credential Manager.
REM @tested tests/unit/run-bat-database-bootstrap.test.js
if not defined ZURI_SUPABASE_RUNTIME_BOOTSTRAPPED (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-with-supabase-runtime.ps1" -BatchPath "%~f0"
  exit /b %ERRORLEVEL%
)

REM Prisma 5.22's Windows schema engine needs a supported Rust log mode
REM under the repository's Node 24 toolchain (warn can terminate bootstrap).
set "RUST_LOG=info"
REM @req FR-046 - clean-checkout local startup owns a SQLite datasource.
REM @spec ADR-017, SDD-024, SEC-008 - caller-provided database authority remains authoritative.
REM @tested tests/unit/run-bat-database-bootstrap.test.js
if not defined DATABASE_URL set "DATABASE_URL=file:./dev.db"

if not defined ZURI_SESSION_SECRET (
  echo [zuri] ERROR: set ZURI_SESSION_SECRET to a random value of at least 32 characters.
  goto :fail
)
if not defined ZURI_SEED_OWNER_PASSWORD (
  echo [zuri] ERROR: set ZURI_SEED_OWNER_PASSWORD to provision the local account credential.
  goto :fail
)

if not exist "node_modules" (
  echo [zuri] Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 goto :fail
)

if defined ZURI_LINE_DB_URL (
  echo [zuri] Verifying isolated Supabase runtime access...
  call npm run phase1:isolation:verify
  if errorlevel 1 goto :fail
)

echo [zuri] Syncing database schema ^(non-destructive^)...
call npm run db:push
if errorlevel 1 goto :fail

echo [zuri] Seeding sample data and the configured account credential ^(idempotent^)...
call npm run db:seed
if errorlevel 1 goto :fail

echo [zuri] Opening http://localhost:3100/login
start "" "http://localhost:3100/login"

echo [zuri] Starting server + UI on port 3100  ^(Ctrl+C to stop^)...
call npm run dev -- -p 3100
goto :eof

:fail
echo.
echo [zuri] Startup failed - see the errors above.
pause
exit /b 1
