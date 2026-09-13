# zuri-harness

A self-contained Claude Code + Codex plugin that pairs a developer's device
with zuri-ai and reports finished-session token usage, attributed to a real
person, device and lane branch — not just to a shared AI account.
(ADR-087, FR-220, FR-221, FR-222.)

## Install

From Claude Code:

```
/plugin marketplace add Freshair129/zuri.ai
/plugin install zuri-harness@zuri-ai
```

For Codex, point Codex's plugin configuration at `.codex-plugin/plugin.json`
in this directory (see your Codex client's plugin documentation for the exact
mechanism) — the skill at `skills/zuri-harness/SKILL.md` is installed with it.

## Pairing

Pairing follows the same browser-approval flow as a Zuri Edge Device (FR-144):

1. Run `/zuri-harness:pair` in Claude Code (or `node bin/zuri-harness.mjs pair
   --server <url>` directly, or from the Codex skill).
2. The command prints an approval link and a six-character check code, and
   tries to open the link in a browser.
3. Open the link, sign in to zuri-ai, confirm the check code shown there
   matches the one printed, and approve the device.
4. The command polls until you approve, deny, or the request expires (about
   five minutes), then saves a credential to your own configuration
   directory.

An approval from an installation operator makes the device `ACTIVE`
immediately. An approval from anyone else makes it `PENDING_ACTIVATION` —
its reports are accepted only once an operator activates it from the harness
device list. Until then, reports are queued locally rather than lost.

Run `/zuri-harness:whoami` any time to see who a device is paired to.

## Reporting

- **Claude Code**: a `SessionStart` hook prints the paired person/device and
  flushes any queued reports; a `SessionEnd` hook (never `Stop`, which fires
  every turn) reports the session that just ended.
- **Codex**: wrap the `codex` binary with `bin/zuri-codex` (macOS/Linux) or
  `bin/zuri-codex.cmd` (Windows) — it runs `codex` unchanged, then reports the
  newest session rollout created since it started. Codex's own exit code is
  never affected by whether the report succeeded.

Each report is scoped to one finished session and counts every billed request
once, using the exact same rules as the repository's own usage meter
(`apps/server/scripts/programme-usage-meter.mjs`, FR-217) — a parity test
(`apps/server/tests/unit/zuri-harness-plugin.test.js`) proves the two never
disagree. Usage is split by git branch, because a report is keyed by
`(source, sessionId, branch)`: one session that worked on two branches sends
two reports.

A session is reported only when it belongs to an allowed repository (default:
`Freshair129/zuri.ai`, configurable in the local config file's `repositories`
list) — for Claude Code this is read via `git -C <cwd> remote get-url origin`,
for Codex from the rollout's own `session_meta.git.repository_url`.

## What is sent — and what never is

Every report carries only:

- `source` (`claude-code` or `codex`), `sessionId`, `branch`, `repository`
- token counts: input, cache-write, cache-read, output
- request count and active minutes (idle gaps over 15 minutes are capped, not
  counted)
- start and end timestamps, and the model used
- an optional `aiAccount` label, if configured, purely to split cost — never
  used as identity

It never sends: prompt or response text, file contents, the zuri-ai password,
or any browser cookie. The plugin never reads browser cookies and never asks
for a zuri-ai password — identity comes only from the paired credential.

## Where the credential lives

The paired credential and local config live in `$ZURI_HARNESS_HOME` (default
`~/.zuri-harness`), never inside this repository or any other. The file is
written with owner-only permissions where the filesystem supports it. The
credential is scoped server-side to reporting usage only (`PROGRAMME_USAGE_
REPORT`) — it is refused by every other route, so a stolen copy can at worst
send a false usage report, which is attributable to the device and revocable.

## Unpairing

Run `/zuri-harness:unpair` (or `node bin/zuri-harness.mjs unpair`) to delete
the local credential. This does not revoke the device server-side — an
installation operator still needs to revoke it from the harness device list
if it should stop being usable entirely.

## Two people, one machine

Identity comes from the paired credential, not from the OS. Two people
sharing one machine are told apart only by pairing under separate OS user
accounts (each gets its own `$ZURI_HARNESS_HOME` under that user's home
directory) or by re-pairing the shared account before each person's session.
A shared zuri-ai account is not supported — `/zuri-harness:whoami` (and the
`SessionStart` hook line) always shows who a device is currently paired to,
so a wrong pairing is visible before a session's usage is misattributed.

## Offline queue

A report that could not be sent is kept as one file per `(source, sessionId,
branch)` key under `$ZURI_HARNESS_HOME/queue/` and retried at the next
`SessionStart`/pairing check or the next report. A resumed session's later,
larger totals replace the earlier queued entry for the same key rather than
piling up beside it. A report the server will never accept (malformed,
unknown task, or a conflicting duplicate) is dropped and logged to
`$ZURI_HARNESS_HOME/log.txt`; anything else (network error, server down,
device not yet activated, credential rejected) stays queued.
