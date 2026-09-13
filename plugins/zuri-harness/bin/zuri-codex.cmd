@echo off
rem @req FR-222 -- Codex wrapper (Windows): run codex, then report its latest
rem   session's usage (FR-221), never letting the report change codex's own
rem   exit code.
rem @spec ADR-087 D7
rem @tested tests/unit/zuri-harness-plugin.test.js
setlocal
set "SCRIPT_DIR=%~dp0"

for /f "delims=" %%T in ('node -e "process.stdout.write(new Date().toISOString())"') do set "START_TIME=%%T"

codex %*
set "CODEX_EXIT=%ERRORLEVEL%"

node "%SCRIPT_DIR%zuri-harness.mjs" report --codex-latest --since "%START_TIME%" >nul 2>&1

exit /b %CODEX_EXIT%
