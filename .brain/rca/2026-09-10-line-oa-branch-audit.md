---
version: "0.3.4"
created_at: "2026-09-10T02:26:00+07:00,RWANG,base 861e9fb4"
last_update: "2026-09-10T04:44:00+07:00,RWANG"
status: beta
attributes:
  domain: line-oa-studio
  scope: LINE OA, CRM, Integration, and optional Edge execution
---

# LINE OA audit — feat/edge-desktop-worker-autoresume

## Scope and provenance

Requested review: duplicated logic, hardcoded values, orphan/dead code, operational improvements, and documentation/code consistency.

- Initial reviewed branch HEAD: `861e9fb4cd0a1343f67d5dde71437b701c06b767`; local and remote branch tips matched when checked.
- Latest reviewed HEAD before implementation: `20bea237da73dbbaf7aabd440b1848194cda1c7f`. During the audit, the original session committed/pushed its tray changes. The audit branch was fast-forwarded to this commit, then the approved remediation was implemented in this isolated worktree. No production worktree, runtime, provider state or external service was changed.
- Branch base: `31afc8ce` (`origin/main` when checked), followed by three desktop commits at the latest reviewed HEAD. Most Server findings are inherited at this branch HEAD, not introduced by those desktop commits.
- Original worktree: `C:/Users/pc/workspace/zuri-ai-edge-autoresume`. Its initially uncommitted `apps/edge/src-tauri/src/lib.rs` and `tauri.conf.json` were inspected as an overlay and were not edited by this audit. Their later committed revision was incorporated by fast-forward, with no audit changes to application code.
- Audit worktree: `C:/Users/pc/workspace/zuri-ai-line-oa-audit`, branch `codex/line-oa-audit-20260910`. Dependencies, disposable test databases and build outputs belong to this worktree; the working tree contains the approved remediation.
- Classification: **C-2**. Remediation risk: **HIGH** for activation/credentials and delivery recovery, **MEDIUM** for UI contracts and worker lifecycle, **LOW** for enumerated unused private symbols and documentation.
- The approved application and test changes are limited to the files listed by the remediation slices below. No production configuration, recipient registry, provider state or external service was changed. No LINE message was sent.

An enumeration of **3,150 tracked files** identified **843 JavaScript/TypeScript runtime files**. The focused exported-symbol scan covers **54 files** across Studio, LINE CRM, LINE ports, conversation execution and the managed worker. A further 42 related Markdown paths were enumerated. This is a targeted audit of the main paths and their dependencies, not a claim that every file or possible runtime path was exhaustively verified.

[Static inventory and symbol references](../audits/2026-09-10-line-oa/static-inventory.json) · [Executable behavior probes](../audits/2026-09-10-line-oa/behavior-probes.json)

## Symptom

The branch builds and the selected existing tests pass, while several reachable Studio controls either throw, submit invalid requests, invent operational success, or show stale/incorrect account state. The native worker's retry loop can also outlive a newer Stop decision. Two pre-send/activation failures violate the documented isolation of account failures.

## Evidence and findings

Line references below refer to the reviewed commit. Priorities are remediation priorities, not claims about observed production incidents.

| ID | Priority | Finding | Evidence level |
|---|---|---|---|
| F01 | P1 | Server activation accepts unavailable/revoked credentials through a broad fallback; UI supplies the handoff assertion automatically | Actual validation closure executed with injected dependencies; code and ADR comparison |
| F02 | P1 | Group test reports success after HTTP 503 or network failure; wrong registry endpoint creates two fabricated ACTIVE groups | Actual handlers executed with injected fetch; route/service enumeration |
| F03 | P1 | Live Chat Send throws `ReferenceError: isLive is not defined` | Actual handler executed; undefined names confirmed in source |
| F04 | P1 | A Project ID becomes an OA account ID, and selection survives Business changes | Entry-to-consumer code trace; browser transition not exercised |
| F05 | P1 | Enterprise Rich Menu and LIFF create payloads fail their actual Zod contracts | Actual payload expressions validated by actual schemas |
| F06 | P1 | An undecryptable oldest READY job repeatedly aborts the shared sending tick | Actual worker executed twice with injected DB/transport boundaries |
| F07 | P1 | Autoresume does not recheck Stop intent during retry; persistence failure is silent | Rust/UI control-flow inspection; native interleaving not executed |
| F08 | P2 | Paused account is labeled LIVE; settings and other mock actions claim persistence or delivery | Actual directory projection probe; reachable handler inspection |
| F09 | P2 | Parallel rich-menu surfaces and copied vocabulary have diverged | Route/import enumeration and consumer/contract comparison |
| F10 | P3 | Five exported symbols have no in-repository code/test/script consumer | Tracked-file enumeration plus AST/name scan, manually reconciled |
| F11 | P2 | Desktop activity-log documentation and its verification coverage describe the preceding UI | Committed source, inventory, and test-target comparison |
| F12 | P2 | Private root/app environment copies and ambiguous deployment instructions obscure which runtime receives configuration | File/key enumeration, installed loaders, read-only Compose configuration and live container metadata |
| F13 | P1 | Legacy LINE settings overlap the new Studio flow; onboarding fabricates destination identity and ignores entered credentials | Setting-to-API/consumer trace and extracted source-handler probes with synthetic inputs |

### F01 — Activation validation fails open

[Account service](../../apps/server/src/modules/line-oa-studio/application/line-oa-account-service.js), lines 343–369, catches every error from secret-manager creation and `resolveServerLineAccount`. Its fallback accepts any connection with `status === 'ACTIVE'`; credential state, provider state, expiry, scope and usable secret material are no longer established by that path.

The probe executes the real `validate` closure with no secret mount, an ACTIVE connection, REVOKED credential and INACTIVE provider. It returns `{ ready: true }`. This proves the fallback's behavior, not an actual activation in a database. The action then sets `serverEnabled=true`/`CONNECTED` if its remaining transaction checks succeed.

[Dashboard](../../apps/server/src/modules/line-oa-studio/ui/LineStudioDashboard.jsx), lines 67–79, and [Projects](../../apps/server/src/modules/line-oa-studio/ui/LineStudioProjects.jsx), lines 105–115, both manufacture `legacyQuiesced: true` when the activation button is clicked. They provide no separate quiescence attestation. The authoritative [ADR-061](../../docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) D3/D8 requires server-held credentials and a quiescent legacy sender.

Prevention: propagate sanitized credential refusals; verify the production/default composition as well as injected ports; require explicit operator attestation for the existing handoff field. Preserve CAS, delivery-reconciliation and epoch fences.

### F02 — Registry mismatch and false test delivery

[Projects](../../apps/server/src/modules/line-oa-studio/ui/LineStudioProjects.jsx), lines 55–90, reads `.lineRegistry` from `/api/platform/integrations` and filters `kind === 'GROUP'`. The [integration listing](../../apps/server/src/modules/integration/application/integration-management-service.js), lines 129–167, returns an array of channel/model metadata and explicitly excludes registry groups/users. The enumerated registry route is [the nested line-registry endpoint](../../apps/server/src/app/api/platform/integrations/line-registry/route.js), backed by `listLineRegistry`; its existing response must be adapted directly rather than inventing another envelope.

When the assumed field is missing, Projects supplies two hardcoded SmartGift groups, external IDs, ACTIVE statuses and current timestamps. The real handler probe with successful empty API responses produces **two invented ACTIVE groups**.

Lines 140–182 submit synthetic inbound events with a fake signature/reply token to the legacy webhook, swallow fetch rejection, ignore HTTP status and unconditionally show successful group delivery. Both HTTP 503 and rejected fetch report `success: true` in the probe. Inbound webhook acceptance would not prove outbound delivery even if a response were successful.

Prevention: read the scoped registry; represent empty/error explicitly; remove fabricated production recipients. Disable the simulated send control in the operational surface. Do not turn a webhook into a send API or add a new dispatch capability as cleanup.

### F03 — Orphaned mock branch breaks Live Chat Send

[Live Chat](../../apps/server/src/modules/line-crm/LineCrmLiveChat.jsx), lines 156–184, still uses `isLive`, `localConversations`, `CHAT_CONVERSATIONS` and `setLocalConversations` after their definitions/imports were removed. Calling the actual handler with nonempty text throws at `isLive` before clearing the draft.

The existing render test does not invoke this click handler. The enumerated CRM conversation routes are GET-only; [the collection route](../../apps/server/src/app/api/crm/conversations/route.js) documents that boundary. `recordLineReply` and `/api/agent/line-delivery` record receipts; they are not general-purpose outbound send APIs.

Prevention: remove the dangling mock branch and show the composer as unavailable/preview until an approved sending contract exists; preserve draft text and do not fabricate a sent message. A new human reply/outbox API is separate scope.

### F04 — Project/account identity and Business changes

[Studio shell](../../apps/server/src/modules/line-oa-studio/ui/LineStudioShell.jsx), lines 40–60, fills `selectedProject` from `/api/projects`, chooses the first Project only when the old selection is null, and does not clear the selection/list on an empty or changed Business. Its asynchronous response also has no cancellation or current-scope guard.

The [design hub](../../apps/server/src/modules/line-oa-studio/ui/LineStudioDesignHub.jsx), lines 70–71, passes that object to Rich Menu and LIFF; each assigns `accountId = project?.id` (Rich Menu line 34, LIFF line 22). A Project UUID is therefore sent to an OA account route. Navigation also keeps selection only in each page's local state, so the selected OA is not an addressable contract across routes.

Prevention: use the canonical OA account list and an explicit account selector preserved in the URL; clear/reset dependent state on Business changes and discard old responses. Keep Project, LINE Group and OA IDs distinct. Backend authorization remains required; this finding does not assert a demonstrated cross-tenant data leak.

### F05 — Designer payloads do not match implemented APIs

[Enterprise Rich Menu](../../apps/server/src/modules/line-oa-studio/ui/LineStudioRichMenu.jsx), lines 90–115, posts top-level `lineOaAccountId`, `layout`, `chatBarText`, `areasJson`. [The actual contract](../../apps/server/src/modules/line-oa-studio/domain/line-oa-rich-menu.js), lines 75–94, requires `accountId`, `code`, `name`, and a strict nested `draft` containing dimensions and typed areas. The probe reports missing `accountId`/`draft` and unrecognized fields. With no selected account, this handler sends nothing but still shows save success.

[Enterprise LIFF](../../apps/server/src/modules/line-oa-studio/ui/LineStudioLiffApp.jsx), lines 65–79, posts `lineOaAccountId` and `scopesJson`; [the registry schema](../../apps/server/src/modules/line-oa-studio/domain/line-oa-liff-app.js), lines 33–46, requires `accountId` and an optional `scopes` array. Its real schema likewise rejects the emitted payload.

Prevention: use the implemented DTOs and enum/domain helpers, preserve draft dimensions/actions and versioned writes, and test the actual designer's submitted payload. Never weaken Zod validation to accept this drift. FR-153 registers an externally issued LIFF app; it does not create one on LINE Developers.

### F06 — Reply-token decryption failure can starve delivery

[Conversation worker](../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js), lines 281–293, catches account-resolution failure and settles the affected job, but calls `unsealLineReplyToken` outside that catch. A wrong/rotated sealing key or corrupt token throws before the selected oldest READY job is changed.

Two actual worker ticks against an injected READY row sealed with fixture key A and opened with fixture key B each throw `LINE_REPLY_TOKEN_UNAVAILABLE`; the row remains READY, no job-specific settlement occurs and no transport is invoked. Future ticks can pick the same row until maintenance expires it. This contradicts ADR-061's documented per-account failure isolation.

Prevention: settle a pre-send decrypt/configuration refusal for that job under CAS, clear unusable material and allow the next tick to progress. Preserve UNKNOWN for any history with a possible send. Do not retry Reply or switch an ambiguous attempt to Push.

### F07 — Pending resume outlives current operator intent

[Desktop lifecycle](../../apps/edge/src-tauri/src/desktop.rs), lines 265–305, reads `worker_autostart` only before entering the retry loop. Each retry checks quitting, then calls `start_worker_locked`, whose guard checks no autostart intent. Stop, lines 224–231, writes the intent false but cancels no pending resume task.

Feasible ordering: automatic attempt fails and sleeps; an operator successfully starts the worker manually; the operator presses Stop; the existing resume wakes and starts it again. The Stop button is also disabled while no child is active ([desktop UI](../../apps/edge/public/desktop.js), line 553), so a dependency retry cannot be directly cancelled through that control.

`remember_worker_intent`, lines 239–248, ignores persistence failure and updates memory first. An identical subsequent Start/Stop returns before trying the write again. The comment that the next successful Start or Stop necessarily rewrites the file is therefore inaccurate; a failed Stop write can leave old autostart intent on disk.

Prevention: check current intent under the lifecycle lock on every automatic attempt, invalidate/wake pending retries on Stop, keep manual Start independent, and surface persistence failure with a retryable dirty state. Add deterministic lifecycle tests with controlled time and injected persistence; no real provider is required. The current Rust tests cover only initially stopped/unpaired states. Native interleaving remains untested in this audit.

### F08 — Mock success and derived health disagree with the model

[Dashboard](../../apps/server/src/modules/line-oa-studio/ui/LineStudioDashboard.jsx), lines 94–105, and Projects lines 201–203 derive LIVE from `serverEnabled || status === 'CONNECTED'`. The canonical service already returns `effectiveStatus`. A fixture with `status='PAUSED'` and `serverEnabled=true` renders `ออนไลน์ (LIVE)` while the domain returns PAUSED.

[Settings](../../apps/server/src/modules/line-oa-studio/ui/LineStudioSettings.jsx), lines 36–49 and 81–95, supplies a fixed channel ID, SmartGift persona/secret-reference text, the legacy webhook URL, and a timer-only save confirmation. Similar active mock actions remain in Flex, Flow, CRM AI actions and CRM rich menu. These are reachable prototype code, not unused modules.

The latest tray commit also hardcodes `Zuri Edge Device — กำลังรับงานอยู่` in [the tray setup](../../apps/edge/src-tauri/src/lib.rs), even when the worker has not started or has been stopped. Use a neutral label or a label derived from the actual worker snapshot.

Prevention: consume canonical health/transport/execution fields; display unknown data as unavailable, not a fabricated operational fact. Gate unimplemented mutations as previews and remove success claims. Use the selected account's native webhook URL. Do not implement new Flex/Flow/loyalty/prompt persistence merely to make a mock button appear functional.

### F09 — Duplication is active and must be consolidated by contract

- `/line-oa/rich-menus` has a functioning, tested [canonical console](../../apps/server/src/app/(pm)/line-oa/rich-menus/page.jsx) using domain enums, versioned drafts and FR-152 publish jobs. `/line-oa/design-studio` reaches a separate incompatible designer; `/customer/line-crm` still reaches a third mock rich-menu editor. All are reachable.
- The user's navigation observation is confirmed by `apps/server/src/config/domains.js:178-179`: Design Studio and Rich Menu are adjacent sidebar items. `LineStudioDesignHub.jsx:27,70` exposes Rich Menu again as a tool using another component. Both surfaces create/edit menu data; this is not an intentional list-versus-designer split. The domain navigation document instead places Rich Menu inside Design Studio (`docs/SITEMAP-DOMAIN-NAV.md:278`), while its surrounding "reserved / no page renders" text predates the implemented surfaces.
- Dashboard and Projects duplicate activation, account mapping, health labels and loading/error handling; the same defects occur twice.
- `LAYOUT_OPTIONS`, `MOCK_RICH_MENU_LAYOUTS` and the canonical `LINE_OA_RICH_MENU_LAYOUTS` vocabulary compete. `LINE_OA_LIFF_APP_STATUSES` is referenced only by a test; it is a declared vocabulary/test seam rather than a verified dead export and remains outside the deletion list.
- Reply, Push and rich-menu transports repeat request/timeout mechanics but deliberately have different retry/ambiguity semantics. A broad transport rewrite is not justified by similarity alone.

Prevention implemented: retain one authoritative rich-menu implementation within Design Studio, remove the sibling sidebar item, and preserve the old URL as an entry to the same tool. CRM is now a contextual link. The canonical draft/version/publish-job behavior, account/tool navigation and Business scope revalidation remain in the existing route/service contracts; only actual shared account/DTO mapping and canonical enums were reused. Reply, Push and rich-menu outcome policies remain distinct.

### F10 — Five zero-consumer symbols, not entire dead modules

The corrected static scan uses TypeScript AST declarations and independent identifier matching across tracked runtime, tests, Rust and scripts. These symbols occur only at their declaration:

| Symbol | File | Proposed action |
|---|---|---|
| `MOCK_RICH_MENU_LAYOUTS` | `apps/server/src/modules/line-oa-studio/ui/mockStudioData.js:264` | Remove unused duplicate list |
| `LINE_OA_RICH_MENU_JOB_STATUSES` | `apps/server/src/modules/line-oa-studio/domain/line-oa-rich-menu-publish.js:17` | Remove unused constant after checking intended public vocabulary |
| `isEditableVersionStatus` | `apps/server/src/modules/line-oa-studio/domain/line-oa-rich-menu.js:166` | Remove unused helper |
| `isKnownVersionStatus` | `apps/server/src/modules/line-oa-studio/domain/line-oa-rich-menu.js:170` | Remove unused helper |
| `isKnownActionType` | `apps/server/src/modules/line-oa-studio/domain/line-oa-rich-menu.js:174` | Remove unused helper |

This is absence of in-repository consumers at the reviewed commit, not a claim about external consumers. The approved branch rechecked the symbols and removed only these five declarations; internal helpers, types, exported test seams, Next entrypoints and test-only connector adapters remain.

### F11 — Documentation describes a previous layout and overstates coverage

[Desktop inventory](../../docs/domains/agent/features/INVENTORY-FR-150-edge-desktop-ui.md) version 0.3.3b, section 12.3, says the activity log is an Overview card at `data-overview-page="3"`, uses tail following and scrolling, and describes four compact Overview pages. Commit `861e9fb4` moves it to its own activity page with pagination. The document was not revised alongside that move.

The inventory's resume acceptance covers starting with Stop intent already false, not stopping while an automatic retry is pending. The Server rich-menu source-contract tests inspect `/line-oa/rich-menus/page.jsx`; green results do not validate the separate Enterprise designer. Live Chat and Dashboard render-only tests do not execute their mutating handlers.

The incremental tray commit `20bea237` also leaves section 12.1 describing window close as stopping the child, while the newly committed close handler hides the window and the tray Quit action stops the child. That new source/document mismatch is included in the same documentation correction; it does not resolve the separate pending-resume intent checks in `desktop.rs`.

Prevention: revise the inventory to the actual page/control model and add lifecycle/interactive contract proof. Add a route-to-capability matrix showing implemented, preview and legacy surfaces. Keep historical candidate SRS/phase notes marked as proposals; their unimplemented future features are not evidence of missing dead code.

### F12 — Environment ownership after monorepo relocation

The primary checkout contains three separate, untracked regular files: `.env`, `apps/server/.env` and `apps/edge/.env`. The root file has 44 keys. Every one currently has the same value in the 47-key Server file; the Server file additionally contains `ZURI_LINE_WORKER_TOKEN`, `ZURI_LINE_REPLY_SEAL_KEY` and `ZURI_LINE_SECRET_FILE_HOST`. No environment values were printed or saved in audit artifacts. Matching current values do not establish who created the copies or when.

The actual loading paths are distinct:

| Entry point | Configuration source | Evidence |
|---|---|---|
| Root `npm run dev/build/start` | Delegates to the Server package; Next reads environment files in `apps/server` | Root `package.json:6-8`, Server `package.json:7-9`, npm lifecycle package-path probe and installed `@next/env` probe |
| Server Docker web | Compose reads `apps/server/.env`, then optional `.env.docker`; explicit `environment` entries override file entries; the container receives a snapshot | `apps/server/docker-compose.yml:32-46`, overlay, `.dockerignore` and read-only rendered configuration |
| Server LINE worker | Compose supplies only its endpoint and worker token; the Node script reads `process.env` and does not load a dotenv file | `apps/server/docker-compose.yml:77-86`, `apps/server/scripts/server-line-worker.mjs:7-8` |
| Standalone Edge CLI started in `apps/edge` | Default `dotenv.config()` reads `.env` from the process working directory; inherited environment values take precedence | `apps/edge/src/config/index.ts:13-16`; running the CLI from another directory changes this source |
| Managed Desktop worker | Desktop settings and private initialization; dotenv is explicitly disabled | `apps/edge/src-tauri/src/commands.rs:87-91`, `supervisor.rs:551-589`, `apps/edge/src/desktop-worker.ts:206-241`; installed 0.3.2 JavaScript has the same skip guard |

Next's installed loader checks existing process values before `.env.<mode>.local`, `.env.local` (except test mode), `.env.<mode>` and `.env`. The read-only development-mode probe found only the primary checkout's `apps/server/.env`; it did not load the root file. No `.env.docker` or other Server environment override file was present in the enumerated primary/deployed application directories.

At the live inspection on 2026-09-10, `zuri-ai-web-1` records Compose provenance under `C:/Users/pc/workspace/zuri-ai-line-ack/apps/server`, while `zuri-ai-line-worker-1` records `C:/Users/pc/workspace/zuri-ai/apps/server`. The two current Server environment files match on all 47 keys, all 47 match the live web container, and the worker token matches between both containers. The web has a read-only external credential mount; its contents were not inspected. The containers were created separately and have different image IDs; this is provenance evidence, not proof of an operational failure. Editing a host file is not evidence that a running container has received the new value.

Read-only `docker compose config` checks with installed Compose **5.5.1** succeeded when called from the primary root with explicit `-f apps/server/...`, from `apps/server`, and from the root with explicit `--env-file apps/server/.env`. Each rendered the Server-file values. A separate synthetic fixture with conflicting parent/app markers also selected the app values for these three forms. This is evidence for the installed version and tested invocations, not every possible shell, `--env-file` or `--project-directory` override.

The inspected installed Desktop package disables dotenv before importing configuration and uses a private working directory. Its settings path resolves to `%APPDATA%/zuri-edge-device/edge-config.json`; only file metadata was inspected. This does not certify the installed native lifecycle behavior. Neither the old Edge checkout nor its `.env` was read.

The documentation gap is concrete: `README.md:84` enters `apps/server`, but `docs/deployment/docker-ngrok.md` begins setup without naming that directory, and `apps/server/scripts/deploy.ps1:6-7` still says "repository root" while lines 27-28 resolve to `apps/server`. The deployment guide also states that the CLI owns the sole LINE webhook, which describes legacy transport rather than the optional ADR-061 Server transport reviewed here. The relocation execution document correctly says app scripts run from their own directories; its statement that the source snapshot copied no actual `.env` is not contradicted by later private operator files.

Prevention: document the entry-point table and application directory explicitly, distinguish dotenv loading from Compose interpolation/container injection, and provide metadata-only inspection commands. Keep file changes, deleting the redundant root copy, credential rotation and container recreation outside this audit's implementation approval. No current token mismatch or automatic root/app merge was observed in the tested entry points. Full redacted evidence: [environment loading JSON](../audits/2026-09-10-line-oa/env-loading-evidence.json).

### F13 — Old and new configuration flows have no single operational owner

The user's follow-up correctly identifies a configuration problem beyond duplicate menu placement. `apps/server/src/app/(pm)/line-oa/integrations/page.jsx:5-8` embeds the entire Platform page, but removing this navigation entry alone leaves the old LINE settings inside Platform and overlapping, incomplete settings inside Studio.

| Setting / operation | Current source and API | Finding |
|---|---|---|
| LINE webhook setup | Platform page `:882-921`, `lineWebhookUrl` in `apps/server/src/lib/public-base-url.js:11-12,54`; Studio Settings `:48-49`; account card `LineStudioEdgeConnection.jsx:682` | Platform and Settings display the legacy forwarding URL as general LINE setup. Platform explains that the device verifies signatures and sends replies; Server accounts instead use `/api/line-oa/accounts/{id}/webhook` under ADR-061 D1/D4. The helper's "only inbound webhook" comment is stale. |
| Group/contact registry | Platform `submitLineGroup` / `submitLineUser` `:247-303` → `/api/platform/integrations/line-registry` → `line-registry-service.js` | This is a real owner-scoped read/write path using `IntegrationConnection` rows with `LINE_GROUP` / `LINE_USER` purposes. Studio Projects calls the wrong metadata endpoint and falls back to samples (F02). Move the working editor/read model; do not discard the only implemented registry writer. Registry scope is Business, not an invented OA assignment. |
| Group identity input | Platform page `:669-683`; Studio Projects sample fallback | A UI button inserts a fixed group ID independent of selected Business. Replace fixed recipients with actual operator input/current registry data; no synthetic registration is authorized. |
| Connect OA | `LineStudioEdgeConnection.jsx:181-239,498-599` → `/api/line-oa/connections`, then `/api/line-oa/accounts` | Form collects Channel Secret/Token; requests send neither. Missing or invalid destination is replaced with a generated `U...` value rather than refused. The API intentionally accepts only metadata and an opaque deployment-secret reference. |
| Channel credentials / bot settings | `LineStudioSettings.jsx:36-42,81-95` | Fixed account/persona defaults, duplicate credential inputs and a timer-based success message with no persistence. These cannot be promoted as the authoritative configuration form. |
| Business selection | Platform page `:117-140`; `ScopeContext.jsx:94-138` | Platform initializes local `targetBusinessId` once. After shell selection changes from A to B, it still chooses A if A remains visible. `currentBusiness` is a valid context alias; the defect is stale local state, not an absent context property. Backend ownership checks remain necessary and do not make a stale but owned Business the operator's intended target. |
| Server model provider / Vault reference | Platform form `:219-238,928-973` → `createPhase1Integration` → `IntegrationConnection` / `IntegrationCredential` | Still consumed: `server-line-answer.js:51-58` calls the Phase 1 runtime with `bindingRequired:false`, then `phase1-runtime.js:210-240` resolves the Business-scoped primary connection. The Phase 1 name does not establish dead code. ADR-061 D8 expressly keeps the model credential boundary. Creation records metadata; it does not activate/promote a model. |
| Execution policy and optional device | Studio account action `CONFIGURE_EXECUTION`; `/api/platform/edge-devices/credentials` pairing contracts | These are distinct from model credential registration. Preserve SERVER/EDGE and local/external permission controls plus real pairing; do not merge device credentials with LINE or model credentials. |

Executable source probes used synthetic form values, API responses, time and scope only. They confirm that both missing and invalid destinations still call provisioning and account creation and show a success message, while the entered channel token/secret are absent from both requests. The same probes confirm that Settings shows save success after zero API calls, and Platform's local form remains on Business A when the shell is on B. The time-change sub-probe produced the same generated destination for its chosen inputs; no claim of time-varying identity is made. These are handler/memo observations, not real provisioning or browser evidence. See [settings probes](../audits/2026-09-10-line-oa/settings-consolidation-probes.json).

The failure mechanism matters: `line-server-provisioning-service.js:12-17` checks the destination's syntax, not its existence with LINE, and persists it as the connection's external identity. `server-line-transport.js:193` then rejects any authenticated webhook whose actual destination differs. A generated identifier cannot establish the provider identity. ADR-061 D8 already specifies metadata-only provisioning and server-held channel secrets; adding secret storage to make the misleading form work would change that approved boundary.

Why this escaped: FR-080 UI tests inspect the Platform page's source and preserve its metadata-only form; the Studio render test exercises device-pairing markup, not OA form submission. Backend provisioning tests supply an explicit destination/reference and deliberately reject raw secret fields. They never exercise the UI's generated identity or discarded credential input. The new Server runtime's use of the existing model resolver was also omitted from the earlier navigation-only recommendation.

Prevention implemented: make Studio the sole LINE setup/registry workspace, remove Platform's legacy LINE editor/webhook tutorial and Studio's duplicate fake credential/settings fields, and preserve the real Integration-owned APIs and model metadata surface. The CRM Multi-OA tab now reads the scoped account API as a status projection and links to Studio; it no longer presents fabricated accounts, metrics or webhook success. The Studio flow requires a provider-issued destination and a provisioned deployment-secret reference; missing/invalid identity is rejected without issuing create requests. Legacy instructions remain only in the explicit legacy context. Settings views bind to the current shell Business, and existing registry IDs, owner checks, audits, metadata, version fences and secret boundaries are preserved. The audit branch carries these changes; production credentials, data and runtime were not changed.

## Root Cause

The confirmed failure mechanisms are localized:

1. Broad credential fallback bypasses the only complete validation boundary (F01).
2. UI code was connected using assumed endpoint shapes, IDs and success states instead of the implemented owner contracts (F02, F04, F05, F08).
3. Mock-to-live conversion left dangling handler references and parallel implementations (F03, F09, F10).
4. Failure settlement and cancellation were implemented for only some branches of the lifecycle (F06, F07).
5. Documentation and tests follow the original surface while newer reachable surfaces and asynchronous interleavings are unverified (F11).
6. App-local execution is implemented, but operator documentation still uses pre-monorepo "root" wording and does not explain independent configuration ownership (F12). The provenance of the private duplicate files themselves is unverified.
7. The Server transport was added without retiring legacy setup guidance or reconciling the new UI with metadata-only provisioning. Parallel local form state, invented identity and mock saves obscure the actual owner of each setting (F13).

These explanations are based on executable source probes or explicit source paths. The audit does not attribute them to a production incident or infer a human author's intent.

## Why the issue escaped detection

The evidence demonstrates the gap: 326 selected Server tests, 33 selected Edge tests, the Server production build and Edge typecheck all pass while the probes reproduce failures. Important existing tests validate the backend/older console or initial render, not the new click handlers and their emitted DTOs. Initial-state Rust guards do not exercise Stop during retry. The decryption branch and default activation validator have different failure behavior from the account-resolution/injected-port paths exercised by existing tests. Governance can confirm a current graph without proving that linked UI behavior satisfies a requirement.

## Proposed prevention

The reviewable implementation scope, ordered slices, domain ownership and regression acceptance are in the [candidate remediation note](../../docs/domains/line-oa-studio/features/REVIEW-LINE-OA-RELIABILITY-2026-09-10.md). No new requirement ID, schema migration, sender, background automation or production rollout is proposed by this audit.

Preserve the useful safeguards already observed: scoped credentials, signature/destination validation, per-account conversation identity, atomic admission, leased completion, epoch/CAS fences, separate Reply/Push uncertainty, accepted-output reconciliation and explicit LEGACY_EDGE selection.

## Validation

| Check | Result | Evidence |
|---|---|---|
| Full Server test suite | **PASS**; 540 files passed, 5 skipped; 4,393 tests passed, 15 skipped (4,408 total) | [Log](../audits/2026-09-10-line-oa/server-full-tests.log) |
| Final LINE/navigation/settings focus | **PASS**; 56 tests across 6 files | [Log](../audits/2026-09-10-line-oa/final-focused-tests.log) |
| Selected Server LINE/backend suites | 271 passed, 5 skipped; 32 files passed and one skipped | [Log](../audits/2026-09-10-line-oa/server-targeted-tests.log) |
| Additional Server UI/configuration/CRM/registry suites | 55 passed in 9 files | [Log](../audits/2026-09-10-line-oa/server-additional-tests.log) |
| `npm run build` | Passed locally | [Log](../audits/2026-09-10-line-oa/server-build.log) |
| `npm run edge:typecheck` | Passed locally | [Log](../audits/2026-09-10-line-oa/edge-typecheck.log) |
| `cargo test --lib` | Passed locally; 43 passed, 4 ignored hardware/packaged-runtime tests | [Log](../audits/2026-09-10-line-oa/edge-targeted-tests.log) |
| `cargo fmt --check` | Known baseline failure in unrelated formatting lines in `commands.rs`, `lib.rs` and `supervisor.rs`; no full-file reformat applied | [Log](../audits/2026-09-10-line-oa/edge-format-check.log) |
| Baseline `npm run docs:check` | Graph current before this proposal | [Log](../audits/2026-09-10-line-oa/governance-baseline.log) |
| Final `npm run govern` | PASS; 0 critical, 0 warnings; combined graph has no duplicate IDs or dangling edges | [Log](../audits/2026-09-10-line-oa/governance-final.log) |
| Behavior probes | 10 observations across false send, handler crash, schema mismatch, queue starvation, activation fallback, invented groups and false LIVE label | [JSON](../audits/2026-09-10-line-oa/behavior-probes.json) |
| Environment investigation | Three primary private files; current Server copies/live values agree; Next loader and three Compose invocation forms verified without exposing values or changing runtime | [JSON](../audits/2026-09-10-line-oa/env-loading-evidence.json) |
| Settings consolidation probes | Missing/invalid destination still provisions in injected flow; entered credentials are unused; Settings reports success without API calls; local Business selection remains stale | [JSON](../audits/2026-09-10-line-oa/settings-consolidation-probes.json) |
| Settings baseline suites | 54 passed in 8 files, no skips; overlaps earlier suites and is reported separately from the earlier 359 baseline passes | [Log](../audits/2026-09-10-line-oa/settings-baseline-tests.log) |

The fifteen skipped tests span five opt-in PostgreSQL/legacy suites; the five-test cross-repository round-trip suite requires `ZURI_CLI_DIST`. No full E2E run, Rust packaged build, installed-device lifecycle check, hosted CI or real provider canary was performed. The behavior probes execute extracted source handlers/expressions and loaded services with injected dependencies; they are not browser or production behavior evidence. F12 separately records read-only live configuration/provenance observations. The review note uses `parent_requirement` so it does not replace the existing primary FR-149 feature note in the generated feature map.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.4 | 2026-09-10 | beta | Replace CRM Multi-OA mock accounts and webhook claims with the scoped read-only status projection; refresh focused evidence | audit branch | RWANG |
| 0.3.3 | 2026-09-10 | beta | Keep Platform model metadata aligned with the shell Business after context changes; refresh focused evidence | audit branch | RWANG |
| 0.3.2 | 2026-09-10 | beta | Fence stale Business account responses and remove fabricated registry status, identity and timestamps; refresh focused evidence | audit branch | RWANG |
| 0.3.1 | 2026-09-10 | beta | Reconcile the canonical Rich Menu deep link and refresh the final focused evidence after the URL contract regression guard | audit branch | RWANG |
| 0.3.0 | 2026-09-10 | beta | Implement approved LINE settings ownership, registry editor, Rich Menu consolidation, LIFF DTO alignment, truthful error states, reply-token isolation and desktop autoresume cancellation; refresh local evidence | audit branch | RWANG |
| 0.2.0b | 2026-09-10 | candidate | Add F13 settings/API/runtime ownership trace and synthetic onboarding/scope probes | reviewed 20bea237 | RWANG |
| 0.1.1b | 2026-09-10 | candidate | Add exact sidebar/Studio duplication evidence and clarify the proposed single workspace | reviewed 20bea237 | RWANG |
| 0.1.0b | 2026-09-10 | candidate | Initial branch audit with RCA, consumer inventory and local evidence; application code unchanged | base 861e9fb4 | RWANG |

Version diff: 0.3.3 → 0.3.4. Records the final CRM Multi-OA mock-removal hardening with refreshed focused evidence; the approved remediation, navigation reconciliation and production boundaries remain unchanged.
