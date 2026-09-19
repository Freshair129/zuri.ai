---
name: zuri-harness
description: Pair this Codex device with zuri-ai and report finished-session token usage attributed to a person, device and lane branch. Use when the user asks to pair, check pairing status, unpair, or asks why usage isn't showing up on the zuri-ai roadmap.
version: 0.1.0
---

# zuri-harness — Codex device pairing and usage reporting

This plugin lets zuri-ai attribute agent token usage to a real person and device
(ADR-087, FR-220..222), instead of only to a shared AI account. It never reads a
browser cookie, never asks for or stores a zuri-ai password, and never sends
prompt or response text — only token counts, active time, branch, repository,
model and session id.

## Commands

Run these with the plugin's CLI, `${CODEX_PLUGIN_ROOT}/bin/zuri-harness.mjs` (or
via the `zuri-codex` wrapper described below):

- **Pair a device**
  ```
  node "${CODEX_PLUGIN_ROOT}/bin/zuri-harness.mjs" pair --server <url>
  ```
  Prints an approval link and a six-character check code, then waits for the
  person to open the link, sign in, confirm the code matches, and approve.
  Never approve a pairing on the user's behalf — only relay the link and code
  and wait for them to act. On success it prints who it paired to and the
  device status (`ACTIVE` or `PENDING_ACTIVATION` — the latter needs an
  operator to activate the device before reports are accepted).

- **Check who this device is paired to**
  ```
  node "${CODEX_PLUGIN_ROOT}/bin/zuri-harness.mjs" whoami
  ```

- **Remove the local pairing**
  ```
  node "${CODEX_PLUGIN_ROOT}/bin/zuri-harness.mjs" unpair
  ```
  This only deletes the local credential file; an operator still has to revoke
  the device from the harness device list server-side if it should stop being
  usable entirely.

For a manually assigned report, append `--task-code TASK-ZAI-###` to a
`report --claude-transcript`, `report --codex-latest` or `report --codex-session`
command. Supply it only when the caller owns that task assignment; shared
branches are never used to infer a task.

## The `zuri-codex` wrapper

Codex has no session-end hook, so usage reporting is done by wrapping the
`codex` binary itself: `bin/zuri-codex` (POSIX shell) and `bin/zuri-codex.cmd`
(Windows) run `codex` with every argument passed through, remember its exit
code, and — once it exits — call:

```
node "${CODEX_PLUGIN_ROOT}/bin/zuri-harness.mjs" report --codex-latest --since <wrapper-start-time>
```

which finds the newest Codex rollout `.jsonl` file created since the wrapper
started, and reports its usage split by branch. Reporting failures never
change the wrapper's exit code — it always exits with `codex`'s own code.
Suggest the user alias `codex` to the wrapper (`alias codex=".../bin/zuri-codex"`
on macOS/Linux, or put `zuri-codex.cmd` ahead of `codex` on `PATH` on Windows)
if they want usage reported automatically on every run.

## What is sent, and what never is

Every report carries only: `source` (`codex`), `sessionId`, `branch`,
`repository`, `model`, token counts (input / cache-write / cache-read /
output), request count, active minutes, start/end timestamps, and usage
detail — reasoning tokens, tool calls per tool name, task starts (prompts) and
compactions (see `docs/ZURI-HARNESS-PLUGIN-SPEC.md`). It never
carries prompts, responses, tool arguments or output, file contents, or any credential other than the
harness credential itself (sent as a bearer token, never logged). A session
whose repository does not match an allowed repository (default
`Freshair129/zuri.ai`, configurable in the local config file) is not reported
at all.

## If a report cannot be sent

The reporter keeps a local queue (`$ZURI_HARNESS_HOME/queue`, default
`~/.zuri-harness/queue`) and retries at the next pairing check or report. A
report is dropped only when the server says it never will be accepted
(malformed, unknown task, or a conflicting duplicate); anything else (network
error, server down, device not yet activated, credential rejected) stays
queued and is retried later — nothing is silently lost.
