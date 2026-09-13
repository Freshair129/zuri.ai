---
version: "1.0.0"
created_at: "2026-09-14T10:00:00+07:00,Claude Opus 5"
last_update: "2026-09-14T10:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "agent harness plugin, browser-approved device pairing and a report-only credential for programme usage"
---

# ADR-087 — Harness usage plugin: browser-paired devices with a report-only credential

**Status:** Accepted on the owner's instruction of 2026-09-14 (TASK-ZAI-069).

**Amends:** ADR-086 D5. The deployment bearer stays, but only for unattended automation. People's agents report through a paired device.

**Relates to:** FR-123, FR-144, FR-217, FR-218, FR-220, FR-221, FR-222, FEAT-034, FEAT-035, ADR-052, SEC-025, ADR-057.

## Context

FR-218 accepts usage reports under one shared deployment bearer. The owner then asked how an agent on another machine would report, and how the board would know which person did the work. In the same conversation the owner settled four choices:

1. **A plugin, not a connector.** A connector is a tool the model chooses to call. The model cannot see the tokens it was billed, so it cannot report them truthfully. It could also forget to call the tool, or call it mid-session and collide with the one-report-per-session rule. The harness wrote the log, so the harness reports from it after the session ends.
2. **Identity comes from a signed-in zuri-ai person, not from the AI account.** Agent logs do not name the human. Two people on one Claude subscription produce indistinguishable logs.
3. **The device is paired through a browser that is already signed in.** The plugin never reads a browser cookie. A person approves once, the same way a Zuri Edge Device is paired (FR-144).
4. **The credential can only report usage.** It lives in a file on a developer's machine for months. A stolen copy may at worst send false usage, which is attributable and revocable. It must never reach business data.

## Decision

### D1 — Pairing follows FR-144

- **Start.** `POST /api/platform/harness-pairing/start` is anonymous and bounded. The harness names itself (`CLAUDE_CODE` or `CODEX`), its device label and, optionally, its OS user. It receives:
  - a request id
  - a device secret
  - a six-character check code
  - an approval link to `/harness/pair`
- **Approve.** The approval page is served only to a signed-in person. It shows the check code, the device label and the harness, and the person approves or denies.
- **Poll.** The harness polls with its device secret. It receives the credential exactly once.
- Pending requests live in memory with a five-minute life. No credential exists until redemption.

### D2 — Who may approve, and what the approval means

- **The approving person is the person the device reports as.** Nobody approves a device on another person's behalf.
- **Approval is refused for a bare signup.** The approver must be an installation operator, or hold at least one visible Business (not the Waiting Room). A bare signup cannot pollute the board.
- **Activation depends on the approver.**
  - An operator's own approval makes the credential `ACTIVE`.
  - Anyone else's approval makes it `PENDING_ACTIVATION`. An operator activates it from the device list, and until then its reports are refused.

### D3 — `HarnessCredential`: one per installation, report scope only

- **Storage.** Each credential is stored as a SHA-256 hash with a display prefix (`hrnk_`). It is bound to:
  - the person
  - a server-issued installation id
  - the harness
  - the device label and OS user, which are labels chosen by the device and never authority
- **Scope.** Its scope is `PROGRAMME_USAGE_REPORT`. Only two routes accept it:
  - the usage report endpoint
  - its `whoami` read, which returns the credential's own person, device and status and nothing else
- **Every other route refuses it.** It is not a session, and `resolveRequestViewer` does not know it. Presenting it anywhere else is the same as presenting nothing.
- **Revocation.** An operator revokes a credential from the device list; the revocation takes effect on its next use.

### D4 — Attribution: person and installation from the credential, lane from the branch

A report sent with a harness credential stores the credential's `personId` and `installationId`, never values from the body.

- **AI account.** The body may name the AI account that paid (`aiAccount`). It is stored as a declared label, used to split cost, and never used for authority.
- **Lane.** The body names the git `branch` it measured, and the server resolves the lane from the programme's declared lanes. The plugin therefore needs neither a task id nor a checkout of this repository.
  - An undeclared branch is stored with no lane and shown as unattributed.
  - An explicit `taskCode` still wins when present.
- **Row key.** A report is keyed by `(source, sessionId, branch)`, so one session that worked on two branches sends two reports.

### D5 — A resumed session extends its report

A resumed Claude Code session ends again with larger totals.

- **Extension.** A second report for the same key is accepted as an extension when both hold:
  - every count and the end time are equal or larger
  - it comes from the same installation

  The row is updated and audited as `EXTENDED`.
- **Replay.** An identical payload is still a replay.
- **Conflict.** Anything else is 409: a smaller count, or a different installation.

### D6 — The deployment bearer is for automation only

`ZURI_PROGRAMME_USAGE_TOKEN` keeps working for unattended automation such as CI or a scheduled job. Its reports carry no person and show as "deployment".

### D7 — The plugin lives in this repository

`plugins/zuri-harness/` carries:

- **Claude Code.** A manifest, a `SessionStart` hook that shows who the device is paired to and flushes the queue, and a `SessionEnd` hook that reports the finished session. It is not `Stop`, which fires every turn.
- **Codex.** A manifest, plus a wrapper that runs Codex and then reports its latest session.
- **Commands and skill.** `pair`, `whoami` and `unpair`, with a skill that explains them.
- **Reporter.** It splits usage by branch and uses the same counting rules as the meter (FR-217), proven by a parity test.
- **Offline queue.** Reports that could not be sent are retried at the next session start.

The repository root's `.claude-plugin/marketplace.json` makes the plugin installable. The credential is stored in the user's own configuration directory, never in a repository.

## Consequences

- Each report names a person and a device, so the board can break a lane down per person. Local meter figures stay "no person", because the logs do not say.
- Two people on one machine are told apart only by separate OS users, which give separate plugin configurations and logs, or by re-pairing. A shared zuri-ai account is not supported. The plugin shows the paired person at every session start, so a wrong pairing is visible.
- The identity lane gains one credential model and five routes. Platform-control gains columns on `ProgrammeUsageReport` and a device list on its console. Both migrations are applied separately (ADR-057).

## Alternatives rejected

**A connector (MCP tool) that the model calls to report.** Rejected (D1): the model does not know its billed usage.

**Reading the browser's `zuri_session` cookie.** Rejected. It is an HttpOnly credential, and FR-123 forbids copying it.

**The FR-123 plugin bearer.** Rejected. It lasts fifteen minutes and carries the person's full capabilities. A report sent hours later would need a fresh browser round trip, and a leaked copy would reach business data.

**The device label or OS user as identity.** Rejected. Any machine can claim any name.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-14 | accepted | Harness plugin, browser-paired devices, report-only credential, attribution to person, installation and lane, resumed-session extension | working-tree | Claude Opus 5 |
