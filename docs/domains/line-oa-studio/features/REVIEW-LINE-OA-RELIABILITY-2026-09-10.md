---
id: ZAI:LINE-OA-RELIABILITY-REVIEW-20260910
title: LINE OA branch audit and reliability remediation
parent_requirement: FR-149
domain: line-oa-studio
source: v2-native
version: "0.3.5"
status: beta
created_at: "2026-09-10T02:26:00+07:00,RWANG,base 861e9fb4"
last_update: "2026-09-11T00:35:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-080
  - type: references
    target: ZAI:ADR-060
  - type: references
    target: ZAI:ADR-061
  - type: references
    target: ZAI:FR-146
  - type: references
    target: ZAI:FR-149
  - type: references
    target: ZAI:FR-150
  - type: references
    target: ZAI:FR-151
  - type: references
    target: ZAI:FR-152
  - type: references
    target: ZAI:FR-153
  - type: references
    target: ZAI:FR-091
  - type: references
    target: ZAI:FR-093
  - type: relates_to
    target: ZAI:FEAT-018
  - type: relates_to
    target: ZAI:FEAT-019
---

# LINE OA — reliability remediation record for the reviewed branch

**เอกสารอนุมัติและบันทึกผล implementation v0.3.0 (beta)**

ตรวจ `feat/edge-desktop-worker-autoresume` ที่ `861e9fb4` และตรวจ delta ถึง `20bea237` พบ 13 กลุ่มประเด็น รวมถึงช่องทางเปิด Server ที่ข้าม credential validation, UI รายงานส่งสำเร็จทั้งที่ request ล้มเหลว, Live Chat handler ที่อ้างตัวแปรซึ่งถูกลบ, designer ที่ใช้ payload ผิด, lifecycle ที่ยังปิด failure/cancellation ไม่ครบ, เอกสาร environment ที่ระบุ root ไม่ชัดเจน และการตั้งค่า LINE เก่า/ใหม่ที่ซ้ำกันพร้อมฟอร์มสร้าง destination ขึ้นเอง

[RCA และหลักฐานรายจุด](../../../../.brain/rca/2026-09-10-line-oa-branch-audit.md) เป็นแหล่งข้อเท็จจริงของการตรวจครั้งนี้ เอกสารนี้บันทึกขอบเขตที่อนุมัติและผล implementation ใน audit branch; ยังไม่มีการ deploy หรือส่งข้อความจริง

## Behavior and ownership

Classification **C-2**; ความเสี่ยงรวม **HIGH** เพราะแตะการตรวจ credential และการตัดสินผลการส่ง ใช้สถาปัตยกรรม ADR-061 เดิม ไม่เปลี่ยน schema หรือ requirement ID

| Lane | Requirement / feature | Responsibility in this change |
|---|---|---|
| LINE OA Studio | FR-146/149/151/152/153, FEAT-018/019 | OA selection, activation, job failure settlement, rich-menu and LIFF DTOs, truthful UI |
| Integration | FR-080 and ADR-061 | Existing registry and credential/LINE ports; retain model metadata management, move LINE-specific editing to Studio through existing APIs, keep scoped authority and failure semantics |
| CRM | FR-091/093/148 | Keep live inbox/read and accepted-outbound record contracts; remove broken mock send/action claims |
| Agent / Edge | FR-150-P2 | Cancel pending automatic resume on current Stop intent; expose persistence failure |

Parent intent: ADR-060/061 and the global FR registry. Peer boundaries: the Studio, Integration, CRM and Agent charters; rich-menu version/publish contracts; LIFF registry; desktop inventory. This note restores those existing contracts and makes preview status explicit. It does not approve a new manual messaging API, Flex/Flow engine, loyalty system, or production handoff.

## Input, output and failures

1. **Account and scope.** Select an OA from the canonical account API. Preserve `accountId` in navigation, scoped to the selected Business. A Project or Group cannot become an OA identifier. Clear the previous selection and dependent data on Business changes and reject late responses.
2. **Activation.** Missing, invalid, expired, revoked or mismatched credentials reject the action. Require explicit confirmation of the existing legacy-quiescence attestation. Preserve version checks, active-send reconciliation and transport epochs. The UI reports the returned account state and safe refusal.
3. **Registry and operational state.** Read the existing scoped LINE registry endpoint and its DTO. An empty/error response creates no synthetic recipient, timestamp or ACTIVE status. Render `effectiveStatus`, `transportMode` and `executionMode` from their owner; a paused account remains visibly paused.
4. **Existing authoring.** Use the strict Rich Menu `accountId + draft` and LIFF `accountId + scopes` contracts. Reuse canonical enums, code normalization, dimensions and typed actions. A save requires an account and a successful response; selected existing drafts hydrate the editor and keep version checks. LIFF remains a registry for a LINE-issued ID.
5. **Preview controls.** Remove fake inbound simulation from operational group testing. Settings, Flex/Flow and CRM actions with no implemented mutation become clearly labeled previews or disabled actions; they cannot display a successful save/send/write. Live Chat retains the draft and read-only conversation functionality. No invented receipt or silent outbound request is allowed.
6. **Delivery recovery.** A pre-send reply-token decryption/configuration failure settles the selected job safely under CAS. Work for other accounts can progress on the next tick. Possible prior sends remain UNKNOWN; Reply is not blindly retried and ambiguity never falls through to Push.
7. **Desktop intent.** Every automatic start rechecks current intent while holding the lifecycle lock. Stop invalidates and wakes the pending retry as well as stopping the current child. Manual Start remains usable. Failed intent persistence remains visible and can be retried even when in-memory intent already has the requested value. The tray label is neutral or follows the actual worker state.
8. **Duplication.** Make Design Studio the single Rich Menu workspace. Move the existing canonical console's draft/version/publish-job behavior into that workspace and retire the independent Enterprise and CRM editors. Remove the standalone Rich Menu sidebar item; preserve `/line-oa/rich-menus` as a compatibility entry that opens the same Studio tool. CRM offers a contextual link to that workspace. Share only repeated account projection/activation logic that has real callers. Remove the five enumerated zero-consumer symbols after rechecking HEAD. Retain live legacy paths, test seams and separate transport uncertainty policies.
9. **Environment ownership.** Explain Server app-local Next/Compose loading, the standalone Edge CLI's working-directory dotenv behavior, and managed Desktop configuration through private initialization with dotenv disabled. Correct deployment instructions and comments that still call `apps/server` the repository root. Keep actual environment values out of evidence and logs. No dotenv behavior change, private-file deletion or runtime recreation is included.
10. **Configuration consolidation.** Remove the old LINE settings hub from Platform and the duplicate Integrations menu in Studio. Studio owns the one operator flow for LINE account setup, account webhook and Business LINE registry. Keep the Integration-owned APIs/storage and the actively consumed Server model/Vault metadata form. Remove fake credential inputs and require a provider-issued destination plus an existing deployment-secret reference for OA provisioning. No browser secret writer or account/recipient migration is added.

## Rich Menu navigation consolidation

The user's follow-up identified duplication between the sidebar sub-domain and the Studio tool. The audit branch now removes the sibling Rich Menu navigation item, mounts the canonical versioned workspace under Design Studio, keeps the old route as a compatibility entry, and replaces the CRM editor with a contextual link. This is one editor with one account selector, rather than parallel state and mock provider outcomes.

| Current entry | Proposed behavior |
|---|---|
| LINE OA sidebar → Design Studio → Rich Menu | One account-scoped workspace containing the real menu list, draft editing, versions and publish-job outcomes |
| LINE OA sidebar → Rich Menu | Remove the duplicate sidebar item; the capability remains under Design Studio |
| Existing `/line-oa/rich-menus` links | Open the same Studio Rich Menu tool; preserve the selected account and current Business scope |
| CRM → Rich Menu | Contextual navigation to the Studio workspace; no independent editor or publish handler |

Use the existing canonical domain/service/API contracts and console behavior as the implementation basis. The Studio visual container does not replace working draft/version/publish capabilities with its current incomplete handler. The selected tool and account must be addressable in the URL so refresh, direct links and browser navigation reopen the intended workspace. Business changes clear and revalidate account selection; navigating from CRM grants no additional authority. Update the domain navigation map and route inventory to describe this single workspace and the compatibility entry.

## Configuration ownership and legacy settings retirement

The earlier navigation-only recommendation is insufficient: retaining the existing Platform page unchanged would retain its obsolete LINE setup instructions. F13 traces each field to its API and runtime consumer; the target below supersedes that recommendation while preserving backend ownership.

| Setting | One editing surface after consolidation | Data / runtime boundary |
|---|---|---|
| OA identity, connection metadata, account webhook and Server activation | Studio account connection flow | Existing `/api/line-oa/connections`, `/api/line-oa/accounts` and versioned account actions; exact provider-issued destination and scoped deployment-secret reference |
| Business LINE group/contact registration | Registry section of Studio's existing Accounts & Groups workspace | Existing `/api/platform/integrations/line-registry`; preserve identifiers, metadata and owner-only authority. Label Business scope; do not invent per-OA assignments or convert registry contacts into CRM customers. |
| Server model provider and Vault reference | Platform Integrations | Existing model metadata API and Business-scoped runtime resolver; no duplicate key/model form in Studio Settings. Metadata creation is not activation. |
| SERVER/EDGE execution and external-model permission | Studio account configuration | Existing `CONFIGURE_EXECUTION` contract; separate from credentials and provider provisioning |
| Optional device pairing / local model settings | Existing Studio pairing entry and Desktop's own local settings respectively | Keep real device-credential contracts; Desktop owns its local provider setup; neither receives LINE transport keys |
| Bot/persona controls without implemented persistence | Explicit preview in Studio, without save success | No new prompt/persona engine or persistence is introduced merely to support mock controls |

Platform retains a connection/status projection and navigation to the selected Business's LINE workspace, but no second LINE group/user editor, account onboarding form or generic legacy webhook tutorial. Its LINE catalog action opens Studio. Existing model metadata controls remain functional. Remove the `/line-oa/integrations` sidebar item; preserve the old URL as a compatibility entry directing operators to the consolidated settings locations, rather than rendering the whole Platform page again. Update inbound links from Studio's group actions accordingly.

The Studio Settings credential/webhook form is replaced by navigation/read-only account state from the same owner as onboarding; there is no second writer. The onboarding form no longer collects unused Channel Secret/Token, fabricates Bot user IDs or invents an unprovisioned secret reference. Missing/invalid destination blocks submission. Raw channel material remains in the approved deployment-managed secret mount. An account metadata save reports precisely that; readiness/activation still requires the actual fail-closed validation in slice 1.

Every settings form follows the shell's current Business. Reset incompatible local account/registry state on a switch and ignore late responses. Do not preserve a local Business selector that can silently override the shell. Existing owner/publisher permissions and version checks apply after navigation; moving UI does not grant write authority.

Retain the legacy forwarding APIs and model resolver that still have consumers. Mark legacy-only webhook guidance by transport mode, update the obsolete "only inbound webhook" comments, and document the owner matrix in the Integration/Studio charters and navigation inventory. This is C-2 UI/contract remediation, with HIGH risk for identity/credential correctness; backend ownership, schema, deployment and stored data do not change.

## Ordered implementation slices

These are local review steps, not new FR IDs or replacements for the existing global phase documents.

| Order | Work | Finding IDs | Risk / verification |
|---|---|---|---|
| 1 | Restore fail-closed activation and isolate pre-send failures | F01, F06 | HIGH; actual default composition, credential negatives, two-account progression, existing fence/ambiguity tests |
| 2 | Consolidate LINE configuration, fix onboarding/registry identity and remove false operational claims | F02, F03, F04, F08, F13 | HIGH for destination/credential correctness; real UI handlers and schemas, no-provider fixtures, Business/account switches, preserved model resolver/registry writes, denied/offline responses |
| 3 | Consolidate Rich Menu navigation/editor in Design Studio and align LIFF requests | F05, F09 | MEDIUM; real schemas, persisted draft/read-back, version conflicts, publish queue states, sidebar/compatibility/CRM entry paths |
| 4 | Make desktop autoresume obey the newest operator intent | F07 | MEDIUM; deterministic time/persistence tests, Start/Stop while retry pending, native lifecycle verification |
| 5 | Remove enumerated unused symbols and reconcile documentation, including environment ownership | F10, F11, F12 | LOW; rerun consumer enumeration, update inventories/runbooks, generate/check governance |

Implementation happens in the audit worktree, fast-forwarded to the latest reviewed `20bea237`. The original session's tray commit is retained. Any later integration must reconcile against the branch's then-current HEAD and preserve other sessions' changes.

## Acceptance criteria

- Activation fails for missing mount/material, expired/revoked credentials, inactive provider and scope mismatch. No failed validation may produce `serverEnabled=true`.
- Handoff confirmation is an actual user attestation; code cannot silently fill `legacyQuiesced=true` on behalf of a click that does not explain the handoff.
- HTTP 400/401/403/409/503 and rejected fetch never show sent/saved success. A provider acceptance is distinct from recipient delivery/read.
- Empty registry stays empty; only current scoped registry entries appear. No fixed channel/group IDs or SmartGift persona are operational defaults for another Business.
- Account selection survives intended navigation, resets when Business changes, and cannot be replaced by a stale response or a Project ID.
- Rich Menu/LIFF UI-generated requests pass actual boundary schemas without weakening validation. Valid draft saves survive reload; missing account or failed write retains the user's draft and shows an error.
- The sidebar exposes Rich Menu under Design Studio without a second sibling item. Old `/line-oa/rich-menus` links and CRM links open the same workspace with the intended account/tool after refresh and browser navigation. One editor owns the flow; no mock publish action can claim a provider outcome.
- A bad sealed token in account A cannot prevent account B's ready work progressing. Existing UNKNOWN/lease/epoch/erasure/receipt-only tests remain green.
- Stop during an automatic retry prevents another automatic spawn, including the ordering automatic failure → manual Start → Stop → retry deadline. Failed persistence is reported and retryable.
- Dead-symbol removal is limited to the five verified symbols and newly unused imports. No legacy daemon, connector fixture, public route or data is removed on the strength of a name search.
- Desktop documentation describes the actual activity page, pagination and lifecycle controls; UI documentation distinguishes implemented, preview and legacy behavior.
- Environment instructions name the application directory, precedence and managed Desktop boundary. Read-only configuration checks report paths, key names and equality only. No claim that editing a host file updates an existing container is allowed.
- LINE account/group/contact settings have one editing surface in Studio. Platform exposes current status/navigation and retains working model metadata management; it no longer embeds the obsolete LINE settings hub. The old Studio Integrations URL remains usable without a duplicate editor.
- Registry reads and writes use the existing scoped API and preserve IDs, metadata and Business ownership. A group/contact is not implicitly assigned to an OA or converted into a CRM record.
- Missing or malformed provider destination produces no provisioning request; a valid explicit destination is preserved exactly. No account identity or recipient is synthesized. No unused raw credential input remains, and a nonexistent/mismatched secret reference cannot pass activation validation.
- Switching the shell Business from A to B cannot leave a settings request targeting A. Account/registry selections reset or revalidate; stale replies cannot restore the previous scope.
- Existing Server external-model resolution through Integration metadata/Vault continues to pass its runtime tests. Legacy forwarding remains available only in its explicit mode, with mode-appropriate instructions.
- CRM's Multi-OA tab reads the scoped account status projection and links to Studio; it contains no fabricated account, follower, token or webhook-success state.
- Run relevant tests, Server build, Edge typecheck/build and governance. Browser verification must exercise the changed interactive routes; Rust and native lifecycle checks apply to the desktop change. Report local, installed-device and hosted evidence separately.

## Validation after implementation

The implementation branch reran the full Server suite, focused contract/integration tests, Rust unit tests and the generated governance chain. The exact commands and results are recorded in the RCA and audit logs below. Fifteen tests across five opt-in PostgreSQL/legacy suites remain skipped; the five-test legacy round-trip suite requires `ZURI_CLI_DIST`. No product runtime rollout or provider delivery is certified by this document.

Documentation governance passes with 0 critical findings, 0 warnings, and no combined-graph duplicate IDs or dangling edges. The [governance log](../../../../.brain/audits/2026-09-10-line-oa/governance-final.log) records the generated checks. This review uses `parent_requirement` and a unique document ID, preserving the primary FR-149 feature note.

The source audit recorded `npm test` with 540 files passed, 5 skipped and 4,393 tests passed, 15 skipped (4,408 total). This isolated completion lane revalidated the LINE/settings/navigation focus with 61 tests across 6 files, the line-job integration with 33 tests, the Server production build and Edge typecheck, and the desktop lifecycle unit focus with 9 tests. The formatter check still reports pre-existing formatting debt in unrelated Edge files; the lane did not reformat those files.

The follow-up environment investigation found three private files in the primary checkout. The root file's 44 values match the Server file, which has three additional LINE worker/secret settings. The two current Server copies and live web environment agree on all 47 keys, and the live web/worker token matches. Next and read-only Compose probes select app-local configuration; managed Desktop disables dotenv. The RCA records the different worktrees used to create the live containers and the limits of these observations. No environment file or container was changed.

The pre-remediation settings follow-up executed extracted handlers/memo expressions with synthetic dependencies and reproduced provisioning after missing/invalid destination, unused credential inputs, a save-success message with zero API calls, and a stale Business selector. The implementation removes those paths and preserves the existing model metadata resolver; post-remediation contract tests cover the new ownership and DTO boundaries. These are bounded local probes, not browser, production or provider evidence. The focused settings baseline run passes 54 tests across 8 files with no skips; it is recorded separately because it overlaps the full test totals.

The isolated Playwright run for the Rich Menu console passed 1/1 with the test's direct project invocation; the full derived warmup was started but not completed in this lane. Installed-device lifecycle verification, hosted CI and a real provider canary were not run. Local source/build/test evidence must not be read as production delivery or deployment evidence.

The completion lane also added deterministic regressions for an automatic resume queued behind the lifecycle lock, the Stop notification registration race, failed worker-intent persistence with retry, and delayed Rich Menu responses after a Business/account switch. Automatic resume now rechecks generation, quitting and persisted intent while holding the lifecycle lock; the Rich Menu workspace clears dependent state and commits only responses matching the current Business/account request generation.

## Exit criteria and exclusions

The approved scope covers the five ordered remediation slices and their regression checks. The audit branch contains the implementation and documentation updates. It does not cover new sending capabilities, new database models/migrations, credential provisioning, changing/deleting private environment files, recreating containers, deploying the Server/desktop package, changing LINE webhooks, sending canaries, or deleting the original Edge workspace/data. Those operations require their own concrete scope and evidence if requested later.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.5 | 2026-09-11 | beta | Fence queued desktop resume and notification registration races; make Rich Menu scope responses and parent account changes deterministic; refresh focused and browser evidence | isolated lane | RWANG |
| 0.3.4 | 2026-09-10 | beta | Replace CRM Multi-OA mock accounts and webhook claims with the scoped read-only status projection; refresh focused evidence | audit branch | RWANG |
| 0.3.3 | 2026-09-10 | beta | Keep Platform model metadata aligned with the shell Business after context changes; refresh focused evidence | audit branch | RWANG |
| 0.3.2 | 2026-09-10 | beta | Fence stale Business account responses and remove fabricated registry status, identity and timestamps; refresh focused evidence | audit branch | RWANG |
| 0.3.1 | 2026-09-10 | beta | Reconcile the canonical Rich Menu deep link and refresh the final focused evidence after the URL contract regression guard | audit branch | RWANG |
| 0.3.0 | 2026-09-10 | beta | Implement approved LINE settings ownership, Rich Menu consolidation, LIFF DTO alignment, truthful error states, reply-token isolation and desktop autoresume cancellation; update evidence and navigation docs | audit branch | RWANG |
| 0.3.0b | 2026-09-10 | candidate | Consolidate LINE configuration and retire legacy settings; preserve live model/registry contracts and correct onboarding identity/credential fields | reviewed 20bea237 | RWANG |
| 0.2.0b | 2026-09-10 | candidate | Specify one Rich Menu workspace under Design Studio; remove duplicate sidebar entry, retain old URL and CRM contextual links | reviewed 20bea237 | RWANG |
| 0.1.0b | 2026-09-10 | candidate | Initial remediation proposal based on 12 audited finding groups, including environment ownership; no application implementation | reviewed 20bea237 | RWANG |

Version diff: 0.3.4 → 0.3.5. Records the isolated completion lane's lifecycle and scope-race hardening with focused/browser evidence; the approved implementation, navigation reconciliation and production boundaries remain unchanged.
