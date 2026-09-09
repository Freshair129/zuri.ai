---
id: ZAI:RCA-EDGE-DESKTOP-RUNTIME-CONTRACT-GAP
version: "0.1.5b"
status: beta
created_at: "2026-09-08T19:06:46+07:00,RWANG,base b17e7258"
last_update: "2026-09-09T01:37:00+07:00,RWANG"
relations:
  - type: relates_to
    target: ZAI:ADR-041
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-062
---

# RCA — Desktop control shell advertised as a working Edge runtime

## Symptom

The user sees the native "Zuri Edge Device Control & Zero-Trust Pair" window
(v0.2.0), NOT PAIRED and blank identity/heartbeat fields, while the local LINE
webhook path has failed. Earlier explanation incorrectly equated this Desktop
with the legacy browser console. The user requested correction of the
documentation/implementation gap.

The screenshot proves the displayed state only. It does not establish whether
the installed app successfully invoked Rust, which configuration it loaded,
or whether a worker process is running. This RCA uses source at b17e7258; it is
not a binary-attestation or installed-device configuration inspection.

## Evidence

| Source | Observed behavior |
|---|---|
| [Tauri config](../../apps/edge/src-tauri/tauri.conf.json) | Window title matches the screenshot; frontend is ../public |
| [Desktop entrypoint](../../apps/edge/src-tauri/src/lib.rs) | Initializes plugins and six commands; no worker launch or periodic heartbeat |
| [Rust commands](../../apps/edge/src-tauri/src/commands.rs) | Pairing parser accepts cloudBaseUrl/cloud_base_url but not apiBaseUrl; missing origin preserves current/default http://localhost:3000 |
| [Console pairing producer](../../apps/server/src/app/(pm)/platform/integrations/page.jsx) | generateNewPairingKeys exports deviceId, key, apiBaseUrl and Business display metadata; download serializes this object |
| [Desktop frontend](../../apps/edge/public/index.html) | is_paired alone becomes PAIRED / READY; load failure logs to console; absent native IPC returns mock success; CLI button always names codex |
| Rust send_heartbeat_now | Uses unconditional healthy status and sends only when called; no dependency probe |
| Rust get_edge_status/import_pairing_payload | Returns serialized configuration including device_key to webview |
| Rust check_headless_cli | Invokes --version only; process output can be reported as success without checking exit status |
| [Existing conversation entrypoint](../../apps/edge/src/cli/conversation.ts) | Starts existing worker loop and 40-second heartbeat with RAG probing, but Desktop does not call it |
| [Edge CI](../../.github/workflows/edge-ci.yml) | Node typecheck/tests/build; no Rust command or Desktop lifecycle acceptance gate |
| [Desktop release workflow](../../.github/workflows/release-edge.yml) | Builds/uploads Rust exe; description advertises headless coordinator, local LLM and 40-second telemetry; does not stage compiled Node worker/runtime |
| Rust inline tests | Default-config test and a separately redeclared RawPairing parser test; no real Console apiBaseUrl fixture passed to actual import logic |

Tracked Rust sources, Edge tests and CI workflows were enumerated before these
coverage claims. Existing Node worker/heartbeat tests are real but do not prove
Desktop integration. The legacy checkout's .env and live pairing keys were not read.

## Root cause

1. **Producer/consumer contract mismatch:** the real Web Console emits apiBaseUrl,
   while the Desktop parser silently ignores that field. A valid download with
   a key can mark the Desktop paired while retaining localhost or a previous
   origin. This is confirmed from both implementations. It is not proof that
   this particular screenshot followed an import or used that wrong origin.
2. **No Desktop runtime lifecycle integration:** a separate Node executor exists,
   but the Tauri entrypoint and release package never wire it into Desktop.
   A visible window cannot establish the legacy 8787 listener or compute worker.
3. **State conflation and swallowed failures:** key presence, server acceptance,
   worker readiness and execution permission collapse into paired/ready text.
   IPC failure leaves initial HTML placeholders; a missing native bridge even
   returns synthetic success. The screen cannot distinguish unconfigured from
   unreadable status.
4. **Claims exceed acceptance evidence:** candidate architecture and release copy
   describe target runtime capabilities as already active. No Desktop end-to-end
   gate establishes the promised flow.

The separate LINE Funnel 502 incident has its own upstream/launcher RCA. This
Desktop gap explains why opening the window is not recovery evidence; it does
not replace that incident's causal chain or establish live LINE ownership.

## Why the issue escaped detection

The parser test duplicates the implementation's assumptions and uses cloudBaseUrl,
so the actual exported apiBaseUrl field is never exercised. Node CI proves the
Node executor independently, and the release workflow proves Rust compilation;
neither proves pairing export -> Desktop import -> authenticated server connection
-> packaged worker -> observed heartbeat. UI defaults hide read failures.
Documentation has no explicit distinction between planned, implemented and
verified capability, allowing the same unsupported wording into release notes.

These are observable coverage/process gaps; intent or a particular historical
author's reasoning is not inferred.

## Proposed prevention

[Revision 1.1.0b remediation specification](../../apps/edge/docs/EDGE-DESKTOP-TAURI-RUNTIME.md)
defines the implementation contract and acceptance gates:

- Reuse the actual Console producer with synthetic values in cross-app parser tests.
- Keep configuration, verification, process, policy and telemetry as separate states.
- Make the existing optional worker the single heartbeat owner; preserve ADR-061,
  Business-scoped leases and Codex policy containment.
- Supervise only owned processes and stage a verifiable Windows runtime artifact.
- Prevent credentials from reaching frontend status/diagnostics.
- Require Rust/Desktop/worker integration tests on PRs and before release; do not
  use build success as runtime evidence.
- Maintain a source-backed capability matrix and release evidence.

Risk HIGH, complexity C-3. The initial documentation proposal left application code
and the installed runtime unchanged. No production credential issuance, provider setting change, real
LINE send, scheduled-task mutation or production activation was performed.

## Validation and disposition

### Baseline compile prerequisite discovered during browser acceptance

Symptom: the E2E warm-up failed to compile LINE CRM before pairing acceptance.
Evidence: baseline b17e7258 already contains a conditional branch in
LineCrmLiveChat.jsx returning two adjacent sibling divs without a fragment, and
LineCrmMembers.jsx closes the mapped ternary branch with an extra brace.
The compiler reported Expected ',' got '{' at the LiveChat sibling. Read-only
comparison with the main checkout also found the same small corrections pending
there; no main-checkout files were modified by this task.

Root cause: malformed JSX introduced before this pairing branch. It is unrelated
to the pairing protocol but prevents whole-app build/browser verification.
Historical CI escape is unverified; this run detected it at compile time.
Apply only the two delimiter corrections under the trivial syntax hotfix rule,
then require the existing production build and browser checks. Do not import
other sessions' unrelated changes or infer production recovery from this repair.

Read-only source comparison confirms the root causes above. The owner subsequently
approved the simple browser/QR pairing slice, now implemented locally with corrected
import and truthful status. [FR-144 evidence](../../docs/domains/identity/features/FR-144-edge-device-credential.md#local-implementation-evidence--2026-09-08)
records passing Server, Edge, Rust and focused browser tests. Broader worker
supervision was open at that earlier checkpoint; installed-device/production acceptance remains open. A local release
build is not evidence that the current production LINE webhook is repaired.

### Provider and worker gap confirmed before 0.3 implementation

The 0.2.1 native command inventory has no provider login, provider-setting save,
model discovery, Start or Stop command. `check_headless_cli` executes `--version`
only. The UI selection supplies the diagnostic binary; it never updates the Node
worker's `ZURI_HEADLESS_BIN`/`ZURI_LLM_*` configuration. `lib.rs` registers commands
but creates no managed worker. The package workflow copies only the Rust exe.
These facts explain why pairing success alone cannot activate Ollama/Claude/Codex.

The Node layer already has an OpenAI-compatible local model adapter and distinct
Codex/Claude arguments. However, `requireHeadlessPolicy` rejects stateless Codex:
empty MCP overrides do not prove inherited configuration was removed. Removing
that check without a tested replacement would violate the compute job boundary.

This gap escaped earlier pairing acceptance because provider control and worker
lifecycle were explicitly outside that slice. The owner now approved their
completion. Prevention is separate provider-state and worker-state acceptance,
fixture tests for configuration/credential isolation and process ownership, and
packaging proof using the same entrypoint the Desktop will run. No installed
account authentication or production activation is inferred from those fixtures.

### Integration failures caught before portable acceptance

Independent Rust/Node fixtures did not initially cover the actual initialization
payload: Rust `Option::None` produced JSON null while Node's optional fields require
absence. Both local and external provider startup could therefore fail despite
isolated unit tests passing. The production serializer now omits absent fields and
the actual packaged entrypoint is exercised through the native supervisor.

Review also found a ready notification overwritten by a following claim, a stale
create-new lock after a forced exit, and post-cancel auth checking a doubly nested
provider directory. State-based readiness, an exclusive Windows handle, one managed
provider root and regression tests address these causes. Frontend state now uses
native process ownership independently of the FAILED label, preserving Stop.

These defects escaped the first separate lane tests because the mocks did not use
the cross-language payload and the real child lifecycle. The explicit portable
test now runs start, idempotent start, accepted heartbeat, stop, crash and restart;
CI/release execute it after package assembly. This is isolated Windows evidence,
not production LINE recovery or live provider account acceptance.

### Native title and updater audit

Symptom: the native title cannot identify the running version; auto update cannot
be verified. Title is a static string in `tauri.conf.json`, with no startup setter.
The running Downloads EXE reports 0.2.0 despite a newer local package existing.
Set the native title from package metadata; no independent version literal.

Updater evidence: the configured public feed returns 404; GitHub release inventory
contains only v0.2.0 EXE/checksum; the configured public key is a comment-only
placeholder. Native/UI inventory contains manual check only. The release workflow
does not produce a feed, updater signature or install operation. Root cause is an
unfinished update distribution/installation path, not a transient download error.
This escaped initial UI expectations because plugin registration and a Check
button were mistaken for a complete updater; the earlier implementation evidence
explicitly excluded signed installer/update release acceptance.

Prevention: retain that distinction, publish a signed full-runtime installer/feed
only with the matching updater client, and require an installed N-to-N+1 upgrade
test (including data retention, stopped worker and rollback/failure handling).
This request audits that path; no signing credentials or published releases were
changed. The title presentation refinement is independently authorized.

### Tabbed layout and machine inventory acceptance

Symptom: the approved Desktop UX must keep controls in one visible page and
show the actual computer name and specifications. Before this change, five
cards and expanding details were stacked vertically; `tauri.conf.json` requested
a 1050x780 client without accounting for taskbar, frame or monitor work area.
`status_value` returned device UUID rather than OS computer name; only pairing
start read COMPUTERNAME. Enumerating native commands found no hardware collector.

Root cause: the initial frontend was a linear configuration form, while machine
identity presentation and hardware diagnostics were not in its status contract.
The earlier mock-IPC tests checked behavior at the default viewport, not bounds
of every control at compact sizes. A device UUID label was not evidence of the
host's actual name. The owner approved the explicit four-tab inventory and
read-only local diagnostics contract before implementation.

Development review also caught a first collector draft that used one final CIM
JSON result under Stop-on-error: a failed late GPU query discarded earlier CPU
and RAM results. The correction must retain partial per-section results, force
UTF-8 for localized names, and kill/reap timed-out helpers. These are acceptance
checks for the new collector, not claims of a failure in a released collector.

Prevention: test visible bounds plus full-content access, provider drafts and
pending operations across navigation; separate OS name from device UUID; compare
native inventory against local OS evidence and cover partial/error/timeout
results. Native work-area/DPI geometry, browser mock IPC, and actual installed
Windows interaction are separate evidence categories.

### Follow-up repair after the interrupted UI implementation — 2026-09-09

The owner requested `check`, then `fix it`. The fresh isolated mock-IPC run
executed 13 tests: eight passed and five failed. All four supported viewport
checks and actual 200% font scaling detected content outside clipping ancestors.
The captured 640x480 AI page also hid the provider form below its card boundary.
The draft applied fixed card heights and overflow clipping without completing
its page navigation. Existing `toBeVisible` assertions accepted elements with
layout boxes even when ancestor clipping made their controls inaccessible.

Code review also found an unbound `openBrowser` button; worker read failures
retained the last healthy state without a separate freshness flag; hardware
refresh exceptions discarded the last successful snapshot; and native update
configuration still advertised a nonexistent feed with a placeholder key.
These are local implementation defects, not evidence of a production incident.

During repair a copied compact-layout branch referenced an undefined `page`
variable and stopped `startup()` before inventory/status loading. A direct
headless page-error probe identified `renderCompactOverview` as the source;
the redundant reference was removed. UI fixtures must capture JavaScript runtime
errors before interpreting missing IPC calls as independent service failures.
The provider review also caught the cloud-to-Ollama switch retaining
`allow_cloud: true`, which the native validator correctly rejects.

Full navigation review found that passing the original viewport assertions did
not prove completion of an AI setup: a blanket enlarged-text footer rule removed
Save from the accessibility tree. Acceptance now enumerates the required controls
for each provider and visits every step. The same check covers Connect and each
Settings child page. Overview prerequisites paginate individually at enlarged
text; hardware facts paginate and long values open the measured full-text reader.
The hardware renderer also incorrectly appended its empty-list message after a
nonempty CPU/GPU list; render that message only for an empty list.

Worker read failure regression cases now start from both STOPPED and RUNNING.
Read freshness invalidates Start even after Overview rerenders, while retained
ownership controls Stop. Provider controls rerender on every worker poll and stay
locked during an in-flight Start/Stop command, including after tab navigation.

Prevention within the approved inventory: navigate complete task groups in
bounded pages; assert ancestor bounds and complete control reachability; retain
ownership separately from read availability; keep last-known hardware with an
explicit stale marker; exercise pairing recovery and provider draft persistence.
The unsigned portable build must return `UPDATER_UNAVAILABLE` locally when no
feed/key is configured, with no network request and no `hasUpdate: false` claim.
Remove the placeholder feed/key. Signed installation and release publication
remain the separate distribution gate described in the approved runtime spec.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.5b | 2026-09-09 | beta | Recorded fresh clipping failures, stale state and incomplete pairing wiring; repair under approved inventory | uncommitted | RWANG |
| 0.1.4b | 2026-09-08 | beta | Recorded linear layout and missing OS inventory contract; acceptance prevents clipped controls and discarded partial diagnostics | uncommitted | RWANG |
| 0.1.3b | 2026-09-08 | beta | Versionless native title and live updater audit: old running binary, missing feed/signature/install path | uncommitted | RWANG |
| 0.1.2b | 2026-09-08 | beta | Provider/worker RCA and cross-language lifecycle regressions; local portable proof, live acceptance remains separate | uncommitted | RWANG |
| 0.1.1b | 2026-09-08 | beta | Approved pairing implemented and locally verified; worker and production gates remain open | uncommitted | RWANG |
| 0.1.0b | 2026-09-08 | candidate | Source-backed Desktop RCA and linked remediation proposal | base b17e7258; uncommitted | RWANG |
