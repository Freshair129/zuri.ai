---
id: ZAI:LINE-OA-P5-DURABLE-CONSOLE-EVIDENCE
version: "0.1.0b"
status: beta
relations:
  - type: relates_to
    target: ZAI:LINE-OA-LOCAL-LLM-CIN-EXECUTION
---

# P5 local console durability evidence

Implements the approved execution plan section 8. C-3 / HIGH because diagnostics
must preserve privacy and never block the LINE reply path.

The previous native console stored only 200 in-memory lines. Native Desktop now
also keeps at most 200 allowlisted events for seven days in `worker-console.json`
beside its own configuration. The file is capped at 1 MiB. One background writer
atomically replaces the snapshot; event intake only updates bounded memory and
tries a bounded notification channel. No disk I/O occurs in the event/answer path.

Only recognized worker lifecycle/outcome codes, UUID job/execution refs, delivery
mode and bounded remaining-budget values are persisted. Free-text lifecycle
notes become a fixed notice; raw messages, credentials, arbitrary child output,
and heartbeat timestamps are excluded. Loaded records use the same allowlist.
Corrupt/oversized storage resets with an explicit gap status.

`get_worker_log` remains compatible. New `get_worker_log_page(cursor)` returns
stable event IDs, bounded pages, an epoch/sequence cursor, gap reason and storage
status (`PENDING`, `DURABLE`, `UNAVAILABLE`). A new native process gets a new epoch
so a lost pending tail cannot reuse IDs or appear silently continuous. Retention
gaps and invalid cursors are explicit. Pending/unavailable diagnostic persistence
never claims success and does not fail a reply. The WebView stores only the
content-free cursor; it reloads native history after reconnect/reload, deduplicates
events, caps its cache and shows gap/storage warnings.

The v2 executor also emits per-turn CONTEXT/MODEL/TOOL start/completion/failure
events from actual invocation lifecycle and tool execution. Spans use the
monotonic clock, current job/execution refs, bounded model identifier and a fixed
tool-name allowlist. Events include elapsed/duration/remaining-budget values;
they never include tool arguments, outputs or prompts. Reporting is scheduled
without awaiting it, and synchronous/asynchronous observer failures are ignored.
CLI and Desktop consume this same projection; native independently revalidates
every field before retaining it. These are measured operation states, not
invented 17-stage statuses or provider delivery confirmations.

Local validation on 2026-09-17:

- New native persistence/redaction/cursor/I/O/progress tests: 6/6 pass.
- Full native lib regression before the fifth new test: 50 passed, four existing
  ignored tests. DPAPI tests first failed inside the restricted sandbox; the
  current-user-profile rerun passed. The ignored tests require Windows CIM,
  PowerShell timing or a freshly assembled portable package.
- JS console tests cover cursor resume, overlapping pages, explicit gaps, stale
  reads, retention/capacity and window history reload.
- Executor progress plus typed products and worker regression: 48/48 pass.
  The progress test executes actual compatible-provider rounds with a synthetic
  fetch response and real tool invocation, including no-memory context and an
  observer that throws. No external provider call or live job is involved.
- Headless Chromium browser preview at 1050x680 and 640x480: gap/storage warning,
  copy button and pagination remained visible; zero page errors. Screenshots
  `p5-console-1050.png` and `p5-console-640.png` are outside the repository in the
  approved visualization workspace. Events were synthetic; this is UI layout
  evidence, not a native Tauri launch or actual device/LINE delivery acceptance.

Version diff: absent -> 0.1.0b documents this approved P5 implementation and its
local evidence boundaries. Production deployment and portable GUI acceptance
remain NOT_RUN.
