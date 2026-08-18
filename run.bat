@echo off
REM ============================================================
REM  Zuri V2 - Project Manager  (server + UI, PostgreSQL runtime)
REM  Double-click to run, or:  run.bat
REM  Serves API + UI on http://localhost:3100
REM ============================================================
setlocal
cd /d "%~dp0"

REM @req FR-054 - inject the dedicated Supabase URL into this process tree only.
REM @spec ADR-035, SDD-027, SEC-011 - credentials remain process-local.
REM @tested tests/unit/run-bat-database-bootstrap.test.js
if not defined ZURI_SUPABASE_RUNTIME_BOOTSTRAPPED (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-with-supabase-runtime.ps1" -BatchPath "%~f0"
  exit /b %ERRORLEVEL%
)

REM Prisma 5.22's Windows schema engine needs a supported Rust log mode
REM under the repository's Node 24 toolchain (warn can terminate bootstrap).
set "RUST_LOG=info"
REM PostgreSQL runtime never enables the local demo session implicitly.
REM Use ZURI_ALLOW_POSTGRES_LOCAL_DEMO=1 only for an approved non-production target.
set "ZURI_LOCAL_DEMO_AUTH="
if "%ZURI_ALLOW_POSTGRES_LOCAL_DEMO%"=="1" set "ZURI_LOCAL_DEMO_AUTH=1"
REM @req FR-030 - normal app startup uses the PostgreSQL application client.
REM @spec ADR-018, ADR-035, SEC-011 - no SQLite fallback and no implicit remote mutation.
REM @tested tests/unit/run-bat-database-bootstrap.test.js
REM If PostgreSQL is not configured, use run-local.bat for the offline SQLite demo.

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

echo [zuri] Verifying PostgreSQL application runtime ^(read-only^)...
call npm run db:pg:verify
if errorlevel 1 goto :fail

if "%ZURI_ALLOW_POSTGRES_SEED%"=="1" (
  echo [zuri] Seeding PostgreSQL demo data ^(explicit opt-in^)...
  call npm run db:seed
  if errorlevel 1 goto :fail
) else (
  echo [zuri] Skipping PostgreSQL demo seed ^(set ZURI_ALLOW_POSTGRES_SEED=1 only for an approved non-production target^).
)

echo [zuri] Opening http://localhost:3100/overview
start "" "http://localhost:3100/overview"

echo [zuri] Starting server + UI on port 3100  ^(Ctrl+C to stop^)...
call npm run dev -- -p 3100
goto :eof

:fail
echo.
echo [zuri] PostgreSQL startup failed - see the errors above.
pause
exit /b 1
