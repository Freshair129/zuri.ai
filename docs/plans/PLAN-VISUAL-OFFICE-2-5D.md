---
title: "Zuri Visual Office 2.5D — Isometric Scene, Avatar, Live State and Approval implementation elaboration"
version: "0.1.0"
status: candidate
created_at: "2026-10-09"
attributes:
  document_type: implementation-plan
  scope: "Existing TASK-ZAI-019..023 / SPR-ZAI-07..08; proposed design and acceptance detail only"
  source_of_truth: false
---

# Zuri Visual Office 2.5D — Implementation elaboration

**Status: CANDIDATE design refinement, NOT implementation approval.** This document expands *existing* programme tasks [TASK-ZAI-019..023](../roadmap/ROADMAP.md). The canonical delivery statuses, evidence, owners and dependencies remain solely in [ROADMAP.md](../roadmap/ROADMAP.md); the 24-week programme is a derived projection. No FR/FEAT/SDD/ADR identity is allocated by this plan; behavioural changes need a separately reviewed canonical requirement/decision under [the documentation integration profile](../migrations/document-reintegration/GOVERNANCE-PROFILE.md).

## 0. Intent, non-goals and source precedence

Build a **Business-scoped** visual office that projects authenticated, provenance-bearing Zuri execution facts into a low-poly isometric 2.5D workplace. The source inspiration is: Three.js orthographic isometric camera, modular glTF rooms, customizable avatars, a desk as a slot, live session state, activity bubbles and state-driven animations. Replace T3 Code sessions with **Zuri-owned** Agent/Business/Mission/Approval read ports. T3 Code and its token are **not** dependencies.

**Non-goals for this slice:** coding-agent harness control, a new global agent scheduler, new CRM/Marketing/Commerce writers, cross-domain direct DB writes, shared account credentials, automatic spending/publishing, an agent factory, autonomous approval, new mission records that falsely claim execution, independent deployment or production activation.

**Authority:** Business data belongs to the domain charter/records and the existing authenticated user. The 3D renderer, speech bubbles and desk positions own **presentation only**. The client never invents Business, Agent, Mission, approval, progress, execution or queue state. Absent/unreliable sources are UNAVAILABLE/UNKNOWN, not idle, zero, complete or success.

**Important distinction:** [ADR-026](../decisions/ADR-026-AGENT-TOPOLOGY-FOR-THE-VISUAL-OFFICE.md) is accepted for **product-building coding agents** and explicitly says they are distinct from user-facing LINE/Business agents. Do not silently apply its single writer per domain, two-layer scheduler or queue-lease topology to business agents. Reuse only projection/provenance and bounded-ownership principles pending an explicit Business Visual Office decision.

## 1. Map the three inspirational steps to Zuri

| Original concept | Proposed Zuri implementation | Source/verification |
|---|---|---|
| Three.js isometric office | Orthographic camera, reusable low-poly glTF room tiles, scene, desk slots and accessible UI | TASK-ZAI-019, TASK-ZAI-021 |
| Each desk is a slot | Stable desk config and optional binding to a **real, authorized** agent instance or business task | TASK-ZAI-019/020 |
| Custom avatar creator | Shared rig, typed appearance manifest, selectable accessories/colors and animation clips; persona does not grant authority | TASK-ZAI-019 |
| T3 session API / WebSocket | Zuri read adapters over Agent Trace, LINE jobs, Mission/Project execution, scoped approvals and business read ports | TASK-ZAI-020/022 |
| Current file / last log | Current authorized task/object reference and bounded redacted **activity label** with provenance | TASK-ZAI-020/022 |
| Working / stuck / done | Validated state → animation mapping; detected blockers only, not guessed from silence | TASK-ZAI-022 |
| Deploy to mobile with auth token | Existing Zuri session, Business/Tenant authorization and responsive web; never expose worker bearer tokens | TASK-ZAI-021/023 |

## 2. TASK-ZAI-019 — Scene, camera, room tiles, avatars and desk slots

### 2.1 Rendering and camera

- Use the existing Next.js 14 + React 18 Server app and existing `three` dependency; `apps/server/src/modules/knowledge/pipeline-map/DataPipelineMap3D.jsx` proves a Three.js path already exists but uses a **PerspectiveCamera** for a different use case. Build a new dedicated scene instead of mutating the Knowledge module.
- Proposed Three.js `OrthographicCamera`: position approximately `(20,20,20)`, target `(0,0,0)`, resize-aware left/right/top/bottom planes from container aspect ratio. This yields an isometric-looking azimuth and elevation; exact camera controls must be design-tested.
- Default camera locked to a 3/4 isometric view; bounded pan and 0.7–2.5 zoom, pointer/touch wheel/pinch and click-to-focus. Do not allow the camera to expose unlicensed/private objects.
- Use a full-window canvas inside the existing authenticated Business shell; route suggestion `/(pm)/virtual-hq` / `/virtual-hq` is a candidate, not an allocated or implemented route. Lazy-load WebGL with a 2D/list fallback when unsupported.
- Treat desktop 60 FPS and mobile >=30 FPS as *targets*, not measured claims. Cap device pixel ratio, suspend inactive-tab animations, reuse materials/geometries, dispose resources and test context loss.

### 2.2 Modular room tiles (glTF/GLB)

- Asset manifest with versioned geometry/texture URLs, semantic names, LOD and license attribution. Suggested directories: `public/virtual-hq/{rooms,furniture,avatars,animations}`.
- Reusable RoomTile assets (small, medium, meeting/approval) and furniture (desk, chair, monitor, cabinet); compose the floor procedurally from a validated config, not one monolithic .glb.
- Do not assume every ERP domain has a staffed agent. A department can have an authorized task dashboard without an agent; an absent feed must not render fabricated occupancy, activity or representative furniture pretending to be a staffed workplace.
- Use instancing for repeated static meshes, compressed textures and bounded polygon budgets. Validate model URL allowlists and reject scripts/untrusted external asset locations.
- Office layout is a presentation projection of **visible** Business departments; inventory/marketing/CRM rights still belong to their domains, not to a room.

### 2.3 Desk semantics

- `DeskSlot` is a stable presentation identity: `deskId, roomId, position, capacity, profileRef?`, optionally `occupantInstanceId` only if the runtime provides that actual instance.
- A desk does not equal a model, Agent Role, Task, Person, or active execution; keep `AgentProfile`, `AgentInstance`, `ExecutionRun` and `DeskBinding` separate.
- Room/layout/avatar appearance may initially be a **read-only, reviewed static manifest**; no new database tables or migrations are presumed. A future persistence model requires separate ownership, authorization, migration and backup decision.
- One visible primary instance per desk in MVP. Additional instances/queues, if present in authorized read ports, appear in Inspector counts, never by duplicating fake avatars.

### 2.4 Avatar creator and animation assets

- Asset categories: shared base rig, heads/body variants, hair/clothing/accessories, palette, role badge, optional organization theme. Animations: idle, typing, thinking, walking, waiting, warning/error, wave/celebrate.
- Save only a bounded `AvatarAppearance` configuration (base asset id, palette key, accessory ids, optional display name). No arbitrary remote glTF upload or scripts, no cloned authorization/agent identity, and appearance does not make an agent "working".
- Use reusable rigs/clip names and `AnimationMixer` with crossfade for transitions. Instance avatars when applicable; bound GPU skinning and animation updates.
- Brand assets require a separate approved brand-kit source. No hardcoded identities, names or logos imported from old screenshots without provenance.

### 2.5 TASK-ZAI-019 acceptance elaboration

1. Real Business selection loads an allowed scene/layout; no actual data -> explicit unavailable/empty state, **never seeded employees or fake busy desks** in production.
2. Camera pan/zoom/focus works with resize/touch; WebGL unavailable -> navigable non-3D list.
3. Scene and avatar models are local/versioned, re-used and have a bounded size budget; asset failure does not crash ERP shell.
4. Run specific scene unit tests, build and Playwright route smoke. Do not mark the original checkboxes complete until actual evidence exists.

## 3. TASK-ZAI-020 — Zuri live-source projection (no T3 Code)

### 3.1 Read adapter ownership

| Existing authority | Candidate read projection | Restrictions |
|---|---|---|
| `src/modules/agent/execution-trace.js` / `AgentTraceEvent` | Proven `MODEL_STARTED`, `TOOL_INVOKED`, `MODEL_COMPLETED`, `EXECUTION_FAILED` etc. | Only admitted, authorized turn/Business; do not disclose raw payloads/prompts |
| LINE OA Studio job / trace services | Conversation job execution, source-bound last safe event | Consent, channel and account access; no PII or delivery tokens in 3D |
| Project Manager `ProjectExecutionRun` / `ProjectExecutionStep` | Run/step state and canonical project/mission links | A PM import run is **not** a universal live agent presence feed |
| Project Manager approval gateway | Scope-approved pending decision and step reference | Existing action classes/state are **not** the proposed L1–L4 ladder |
| Marketing Operations and campaign execution read models | Intake/handoff/roadmap references | Active Campaign != running Marketing AI |
| CRM Sales Tasks | Authorized due/open follow-up references | Open human SalesTask != executing AI |

**Existing relevant files** (Server-relative): `src/modules/agent/execution-trace.js`, `src/modules/agent/role-registry.js`, `src/modules/project-manager/application/project-execution-trace-service.js`, `src/modules/project-manager/application/approval-gateway.js`, `src/modules/marketing/application/marketing-operations-service.js`, and `src/app/api/crm/sales-tasks/route.js`. Source existence is **not** production readiness evidence.

### 3.2 Snapshot contract — candidate

Proposed `GET /api/virtual-hq/snapshot?businessId=<id>` returns one authorized, bounded, server-built snapshot. The selected Business is a selector, **not authorization**; resolve trusted viewer from session, verify the exact Business, and enforce every contributing read-port policy. This route does not exist yet.

```json
{
  "schemaVersion": "virtual-hq.snapshot.v1",
  "scope": {"businessId": "<authorized-business-id>"},
  "observedAt": "<ISO-8601-server-time>",
  "feedStatus": "PARTIAL",
  "rooms": [{"roomId": "marketing", "availability": "AVAILABLE"}],
  "agents": [{
    "agentInstanceId": "<runtime-issued-id>",
    "agentProfileId": "<approved-role-reference>",
    "deskId": "marketing-desk-01",
    "state": "WORKING",
    "animationHint": "typing",
    "activity": {
      "label": "Analyzing campaign performance",
      "objectType": "MARKETING_CAMPAIGN",
      "objectRef": "<opaque-authorized-ref>"
    },
    "source": {
      "kind": "AGENT_TRACE",
      "executionId": "<opaque-execution-id>",
      "sequence": 18,
      "observedAt": "<ISO-8601-source-time>"
    },
    "freshness": "LIVE"
  }],
  "approvals": {"availability": "UNAVAILABLE", "reason": "L1_L4_GATE_NOT_READY"}
}
```

**No production DTO commitment:** names/fields, limits, retention, data providers and state precedence remain subject to reviewed acceptance.

### 3.3 Source truth rules

- Every displayed number/state/text has a source kind, scope, timestamp, object reference and freshness. Unknown, missing, rejected, partial or stale sources must be distinct.
- The projection must not materialize raw model logs, prompts, full customer messages, arbitrary file paths, provider credentials or cross-Business summaries.
- Only expose a bounded, redacted `activity.label` derived from an allowlisted event/action display template; no raw tool arguments in speech bubbles.
- `progress` is nullable unless a source owner publishes an actual milestone/weighted progress policy. Never assign a decorative percentage or "done" from a single model response.
- Different entities and timelines must not be confused: CAMPAIGN active, SALESTASK open, PM step completed and Agent turn completed each retain their source semantics.
- A static `AgentRole` entry means an eligible role, not a live worker; a missing execution cannot manufacture AgentInstance, activity or occupancy.

### 3.4 TASK-ZAI-020 acceptance elaboration

1. Each rendered Business, Agent, Mission and Approval object resolves to one authorized owner read model with source/observedAt/proof state.
2. Missing feed shows `UNAVAILABLE` naming the feed; unauthorized detail is omitted (not disabled controls with leaked labels).
3. Two-Business, two-user integration regression proves no role/Business/Tenant leak; viewer denial fails closed.
4. E2E asserts DOM/scene/inspector values against API responses; no fixture-only success claim.

## 4. TASK-ZAI-022 — State machine, live event stream and animations

### 4.1 State machine contract

| Normalized state | Required evidence | Avatar behavior |
|---|---|---|
| `IDLE` | Positive runtime evidence of available worker with no active mission | Idle / wait |
| `THINKING` | Fresh `MODEL_STARTED` for live execution | Thinking |
| `WORKING` | Fresh active tool/step/turn with nonterminal state | Typing at desk |
| `WAITING_APPROVAL` | Authorized pending approval with matching active mission | Wait; show approval mark |
| `BLOCKED` | Explicit blocker/expired lease/approved timeout signal | Warning; optionally constrained wander |
| `COMPLETED` | Authoritative successful terminal run/mission | Wave **once**, then neutral |
| `FAILED` | Authoritative failed execution | Error indicator |
| `STALE` | Source observation older than configured freshness budget | Freeze work animation; stale indicator |
| `UNKNOWN` | No trusted provider/state | No assertion of activity or idle |

No heartbeat or log silence alone can classify `BLOCKED`. A running inference may be silent; blocked detection requires a domain-approved watchdog, lease or timeout policy. Terminal delivery uncertainty must remain uncertain; **do not replay side effects** because an animation was interrupted.

### 4.2 Stream protocol

- MVP uses scope-authorized snapshot polling, suggested 3–5 seconds while visible with jitter/backoff/rate limits. SSE is preferred first upgrade for one-way business events; WebSocket only when two-way traffic is justified.
- Candidate `GET /api/virtual-hq/events` must authenticate and recheck scope on reconnect; stream only sanitized projection envelopes. Server-sent event shape: `eventId, schemaVersion, businessId, agentInstanceId, executionId, sequence, occurredAt, state, safeLabel`.
- Client de-duplicates by identity/sequence, ignores older observations, resyncs a full snapshot on gaps and auth/scope change, and enters `STALE` after source-specific freshness TTL.
- Source ownership and event creation remain in each authoritative domain/service. Do not alter `AgentTraceEvent` vocabulary without a reviewed contract; adapter projections cannot write operational state.
- Event stream is observability **not scheduling**. Do not create a second authoritative agent queue to animate the office.

### 4.3 Speech bubble and Inspector

Speech bubble uses short bounded text (suggested <=100 visible characters; escape untrusted data, never render HTML), source freshness and a stable short role/agent label. Current "file" in the inspiration maps to an authorized Zuri `objectType/objectRef`; "last log" maps to a redacted human-readable event summary. Clicking a desk opens a Business-scope inspector: role, current task, source, timestamps, execution/approval references and safe deep links to owner routes. Inspector must distinguish `NOT_RUN`, `UNAVAILABLE`, `STALE` and `COMPLETE`.

### 4.4 TASK-ZAI-022 acceptance elaboration

1. A **real controlled agent turn** triggers thinking/working/terminal transitions in-scene within an approved measured latency budget, not a simulated animation timer.
2. Real "no mission" presence renders IDLE; no evidence renders UNKNOWN/UNAVAILABLE.
3. Duplicate/out-of-order events, reconnect, source failure, multi-tab and browser backgrounding do not falsely return WORKING/COMPLETED.
4. An approval's denied/expired state never auto-continues an execution.

## 5. TASK-ZAI-021 — Responsive accessibility and motion

- Canvas objects must have equivalent HTML action/label surfaces in the DOM; keyboard tab/focus, Enter/Space actions and screen reader descriptions must work without WebGL.
- Respect `prefers-reduced-motion`: disable transitions, particles, auto-camera and idle animation; keep immediate status/alert changes and usable still imagery or list.
- Provide list/table fallback and mobile list + bottom-sheet Inspector, touch-friendly targets, no horizontal overflow and avoid heavy avatar rigs on small screens.
- Design-system semantic tokens drive accessible colors and focus rings; status is identified by text/icon, not color alone. Bubbles and live updates should not flood ARIA announcements.
- Verify keyboard-only, screen-reader semantics, reduced-motion and mobile 390x844/430x932 viewports.

## 6. TASK-ZAI-023 — Approval in the office, not an authorization bypass

- Reuse the *owner* approval service; Virtual HQ never creates its own approval decision table or elevated role.
- Treat `TASK-ZAI-010` (L1–L4 Approval Gateway) and `TASK-ZAI-011` (verification/notification fabric) as dependencies that the current canonical roadmap still records as `planned / UNKNOWN / NOT_STARTED`. PM `ProjectApprovalRequest` has action classes `READ_ONLY, PROJECT_WRITE, EXTERNAL_MESSAGE, SPEND, CREDENTIAL_CHANGE, MERGE, DEPLOY, DESTRUCTIVE` and states such as `PENDING/APPROVED`; these do **not** prove L1–L4 approval semantics exist.
- Phase 1 may display authorized **existing PM** approvals with accurate type/provenance. Do **not** display a fictitious `L3` badge if no approved ladder supplies it.
- In-scene approval action is gated until approved L1–L4 API, step-up, two-person/segregation-of-duties, exact effect digest and audit equivalence are verified. Decision must call the owner API and then refresh authoritative state; never optimistically mark it approved.
- Unauthorized approvals are **absent**, not merely disabled. Approval cannot be inferred from a manager avatar.

## 7. Proposed module & ownership map

**Candidate paths only, not implemented or approved ownership allocations**:

```text
apps/server/
  public/virtual-hq/{rooms,furniture,avatars,animations}/
  src/app/(pm)/virtual-hq/page.jsx
  src/app/api/virtual-hq/{snapshot,events}/route.js
  src/modules/virtual-hq/
    application/{office-read-model,agent-state-adapter,event-projection}.js
    domain/{scene-contract,state-machine}.js
    components/{OfficeScene,IsometricCamera,RoomTile,DeskSlot,AgentAvatar,
                SpeechBubble,AgentInspector,MobileFallback}.jsx
```

Existing Business Shell and `src/context/ScopeContext.jsx`, `src/config/domains.js`, `src/modules/agent/role-registry.js`, Agent execution traces, Marketing/CRM owner read models, Project execution and Approval Gateway are integration candidates. The Domain Charter for project-manager currently claims `src/app/(pm)/**` and broad `src/app/api/**`; settle code ownership and governance before introducing a separate `virtual-hq` module or route, **do not automatically create a new Business Domain**. Do not change charter permissions by adding a UI room.

Three.js direct is already dependency-compatible. React Three Fiber is an optional later reviewed choice; verify its React-18 compatibility and actual bundle/performance profile, never blindly install the newest major.

## 8. Delivery order, dependency and verification gates

| Canonical task | Refined delivery | Existing dependency | Proof required |
|---|---|---|---|
| `TASK-ZAI-019` | Scene/GLB/orthographic camera/avatar/desk/empty state | `TASK-ZAI-012` | True source-bound scene, empty-state, asset and route tests |
| `TASK-ZAI-020` | Scope-authorized Business/Agent/Mission/Approval read projection, inspector | `TASK-ZAI-019` | Owner-port mapping, source provenance, cross-tenant denial |
| `TASK-ZAI-021` | Keyboard, reduced-motion, mobile/fallback | `TASK-ZAI-019` | A11y + responsive E2E |
| `TASK-ZAI-022` | Freshness, live presence, SSE/poll, speech bubble & animations | `TASK-ZAI-020` | Real agent turn; ordering/reconnect/stale E2E |
| `TASK-ZAI-023` | Approved L1–L4 queue and governed action | `TASK-ZAI-011`, `TASK-ZAI-022` | Authority, audit equivalence, denial + step-up E2E |

**Safe parallel prototype:** Isometric scene, GLB tests and avatar animations may use labeled design fixtures in isolated previews, but such fixtures never ship as live status and do not satisfy TASK-ZAI-019 or TASK-ZAI-022 source-backed acceptance. The mission feed and approval ladder remain blocking delivery dependencies unless re-reviewed under existing governance.

**Tests to implement when code is authorized:** pure normalization/transition tests; asset loading and cleanup; API tenant/Business/scope denial; partial/unknown/stale data contract; source-port integration; WebGL fallback; RTL/Thai text wrapping; reduced-motion/keyboard/mobile; snapshot/stream ordering/reconnect; human approval same audit as owner API; no cross-domain write and no raw secret/PII disclosure. Use isolated DB/tests and existing `npm test`, `npm run build`, `npm run test:e2e`, and `npm run govern`; E2E needs a real Browser/Runtime trace for the live acceptance. Report actual results by environment (local, CI, production), never infer passes from design review.

## 9. Open decisions before implementation

1. **Business Visual Office topology:** ADR-026 covers coding-agent lanes; choose Business AgentInstance/Mission/Desk identity and queue/presence owner separately.
2. **Source of truth for presence:** define positive IDLE evidence, heartbeat, leases, event sequence/freshness budget and source priority. The current Agent Trace is not a generic scheduler.
3. **L1–L4 approval:** align planned TASK-ZAI-010/011 with existing PM approval classes without asserting equivalence.
4. **Persistence:** decide whether layout/avatar appearance needs durable Business-scoped tables, and only then allocate domain owner, migrations, RBAC and backup policy.
5. **Rendering choice and metrics:** profile bare Three.js versus React Three Fiber on mobile with measurable asset/FPS/memory budgets.
6. **Navigation placement and scope:** candidate Business Home /virtual-hq is not yet a route or a permission key; agree on least-privilege cross-domain projection.

## 10. Document/evidence state

- This elaboration changes **no code, routes, table, migration, runtime, identities, requirements, approvals, roadmap status or acceptance checkbox**.
- It does not mark any task or delivery gate passed, and does not override the canonical [ROADMAP.md](../roadmap/ROADMAP.md).
- If this proposal changes system behavior, migrate/review the required canonical FR/NFR/SDD/ADR records first; do not hand-edit generated PRD/FEATURES exports.
- At implementation time review `AGENTS.md`, `CLAUDE.md`, [verification policy](../architecture/VERIFICATION-POLICY.md), domain charters, the exact source revision, and run the required document registry/graph/views/governance chain and actual tests.

**Version diff 0.0 → 0.1.0 (2026-10-09):** Candidate design elaboration mapping the Three.js/T3/animation inspiration into existing Zuri Visual Office tasks; source-of-truth, scope, identity, approval and test gates unchanged.
