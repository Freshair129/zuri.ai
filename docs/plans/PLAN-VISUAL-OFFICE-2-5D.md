---
title: "Zuri Visual Office 2.5D — Isometric Scene, Avatar, Live State and Approval implementation elaboration"
version: "0.2.0"
status: candidate
created_at: "2026-10-09"
attributes:
  document_type: implementation-plan
  scope: "Existing TASK-ZAI-019..023 / SPR-ZAI-07..08; proposed design and acceptance detail only"
  source_of_truth: false
---

# Zuri Visual Office 2.5D — Implementation elaboration

**Status: CANDIDATE implementation elaboration.** The owner approved the product topology on 2026-10-23: Visual Office is a separately deployed, optional web client registered with Zuri; Zuri owns authentication, authorization, domain APIs and business records. This document expands *existing* programme tasks [TASK-ZAI-019..023](../roadmap/ROADMAP.md), but it does not approve an API contract or implementation. Platform-backed work waits for the owner contracts listed in [the client architecture design](../architecture/2026-10-22-visual-office-zuri-client-design.md). The canonical delivery statuses, evidence, owners and dependencies remain solely in [ROADMAP.md](../roadmap/ROADMAP.md); the 24-week programme is a derived projection. No FR/FEAT/SDD/ADR identity is allocated by this plan; behavioural changes need a separately reviewed canonical requirement/decision under [the documentation integration profile](../migrations/document-reintegration/GOVERNANCE-PROFILE.md).

## 0. Intent, non-goals and source precedence

Build a **Business-scoped** visual office that projects authenticated, provenance-bearing Zuri execution facts into a low-poly isometric 2.5D workplace. The source inspiration is: Three.js orthographic isometric camera, modular glTF rooms, customizable avatars, a desk as a slot, live session state, activity bubbles and state-driven animations. Replace T3 Code sessions with **Zuri-owned** Agent/Business/Mission/Approval read ports. T3 Code and its token are **not** dependencies.

**Non-goals for this slice:** coding-agent harness control, a new global agent scheduler, new CRM/Marketing/Commerce writers, cross-domain direct DB writes, shared account credentials, automatic spending/publishing, an agent factory, autonomous approval, new mission records that falsely claim execution, a Visual Office backend/database, inventing Zuri API or authentication contracts, and production activation. Independent frontend deployment is the approved target; deployment and client registration are not yet implemented.

**Authority:** Business data belongs to the domain charter/records and the existing authenticated user. The 3D renderer, speech bubbles and desk positions own **presentation only**. The client never invents Business, Agent, Mission, approval, progress, execution or queue state. Absent/unreliable sources are UNAVAILABLE/UNKNOWN, not idle, zero, complete or success.

**Floor projection:** show G/Lobby plus exactly one floor per authorized, visible leaf Business domain returned by Zuri. Domain groups, modules, and services do not create floors or grants. A returned department remains visible when it has no agents; the Office must show an empty-agent state instead of inventing staff.

**Important distinction:** [ADR-026](../decisions/ADR-026-AGENT-TOPOLOGY-FOR-THE-VISUAL-OFFICE.md) is accepted for **product-building coding agents** and explicitly says they are distinct from user-facing LINE/Business agents. Do not silently apply its single writer per domain, two-layer scheduler or queue-lease topology to business agents. Reuse only projection/provenance and bounded-ownership principles pending an explicit Business Visual Office decision.

## 1. Map the three inspirational steps to Zuri

| Original concept | Proposed Zuri implementation | Source/verification |
|---|---|---|
| Three.js isometric office | Orthographic camera, reusable low-poly glTF room tiles, scene, desk slots and accessible UI | TASK-ZAI-019, TASK-ZAI-021 |
| Each desk is a slot | Stable desk config and optional binding to a **real, authorized** agent instance or business task | TASK-ZAI-019/020 |
| Custom avatar creator | Shared rig, typed appearance manifest, selectable accessories/colors and animation clips; persona does not grant authority | TASK-ZAI-019 |
| T3 session API / WebSocket | A registered Visual Office client consumes authorized Zuri owner APIs; transport and DTOs come from reviewed Zuri contracts | TASK-ZAI-020/022 |
| Current file / last log | Current authorized task/object reference and bounded redacted **activity label** with provenance | TASK-ZAI-020/022 |
| Working / stuck / done | Validated state → animation mapping; detected blockers only, not guessed from silence | TASK-ZAI-022 |
| Deploy to mobile with auth token | Existing Zuri session, Business/Tenant authorization and responsive web; never expose worker bearer tokens | TASK-ZAI-021/023 |

## 2. TASK-ZAI-019 — Scene, camera, room tiles, avatars and desk slots

### 2.1 Rendering and camera

- Build the scene inside the separately deployed Visual Office frontend, using that client's supported React/Three.js stack. Do not import Zuri Server modules or couple the Office to Server package internals; reuse of an existing Zuri renderer is not assumed.
- Proposed Three.js `OrthographicCamera`: position approximately `(20,20,20)`, target `(0,0,0)`, resize-aware left/right/top/bottom planes from container aspect ratio. This yields an isometric-looking azimuth and elevation; exact camera controls must be design-tested.
- Default camera locked to a 3/4 isometric view; bounded pan and 0.7–2.5 zoom, pointer/touch wheel/pinch and click-to-focus. Do not allow the camera to expose unlicensed/private objects.
- Use a full-window canvas in the optional Visual Office client. Zuri sign-in, client registration, allowed origins/callbacks, and Business selection must follow owner-published contracts; no Zuri shell route or callback path is selected here. Lazy-load WebGL with a 2D/list fallback when unsupported.
- Treat desktop 60 FPS and mobile >=30 FPS as *targets*, not measured claims. Cap device pixel ratio, suspend inactive-tab animations, reuse materials/geometries, dispose resources and test context loss.

### 2.2 Modular room tiles (glTF/GLB)

- Bundle curated GLB assets and a manifest with immutable versions/hashes, semantic names, LOD and license attribution in the Visual Office frontend. Exact asset paths remain that repository's implementation detail; no shared catalog or object-storage API is assumed.
- Reusable RoomTile assets (small, medium, meeting/approval) and furniture (desk, chair, monitor, cabinet); compose the floor procedurally from a validated config, not one monolithic .glb.
- Do not assume every ERP domain has a staffed agent. A department can have an authorized task dashboard without an agent; an absent feed must not render fabricated occupancy, activity or representative furniture pretending to be a staffed workplace.
- Use instancing for repeated static meshes, compressed textures and bounded polygon budgets. Validate model URL allowlists and reject scripts/untrusted external asset locations.
- Office layout is a presentation projection of **visible** Business departments; inventory/marketing/CRM rights still belong to their domains, not to a room.

### 2.3 Desk semantics

- `DeskSlot` is a stable presentation identity: `deskId, roomId, position, capacity, profileRef?`, optionally `occupantInstanceId` only if the runtime provides that actual instance.
- A desk does not equal a model, Agent Role, Task, Person, or active execution; keep `AgentProfile`, `AgentInstance`, `ExecutionRun` and `DeskBinding` separate.
- Room/layout/avatar appearance may initially be a **read-only, reviewed static manifest**. No new database tables or migrations are presumed; cross-device scene saves require a designated Zuri-owned presentation resource and an approved versioned API contract. Until then, Studio changes remain local drafts with explicit export.
- One visible primary instance per desk in MVP. Additional instances/queues, if present in authorized read ports, appear in Inspector counts, never by duplicating fake avatars.

### 2.4 Avatar creator and animation assets

- Asset categories: shared base rig, heads/body variants, hair/clothing/accessories, palette, role badge, optional organization theme. Animations: idle, typing, thinking, walking, waiting, warning/error, wave/celebrate.
- Save only a bounded `AvatarAppearance` configuration (base asset id, palette key, accessory ids, optional display name). No arbitrary remote glTF upload or scripts, no cloned authorization/agent identity, and appearance does not make an agent "working".
- Use reusable rigs/clip names and `AnimationMixer` with crossfade for transitions. Instance avatars when applicable; bound GPU skinning and animation updates.
- Brand assets require a separate approved brand-kit source. No hardcoded identities, names or logos imported from old screenshots without provenance.

### 2.5 TASK-ZAI-019 acceptance elaboration

1. Real Business selection loads an allowed scene/layout; no actual data -> explicit unavailable/empty state, **never seeded employees or fake busy desks** in production.
2. The view shows one G/Lobby plus one floor per authorized visible leaf domain returned by Zuri; domain groups/modules/services add no floors, and a returned domain with zero agents still renders its department empty state.
3. Camera pan/zoom/focus works with resize/touch; WebGL unavailable -> navigable non-3D list.
4. Scene and avatar models are bundled/versioned, re-used and have a bounded size budget; asset failure does not crash the Office client.
5. Run scene unit tests, client build and browser route smoke. Do not mark the original checkboxes complete until actual evidence exists.

## 3. TASK-ZAI-020 — Zuri live-source projection (no T3 Code)

### 3.1 Read adapter ownership

| Zuri owner | Candidate read projection consumed by Office | Restrictions |
|---|---|---|
| Agent Runtime owner API | Proven model/turn/tool/terminal state | Only admitted, authorized turn/Business; no raw payloads/prompts |
| LINE OA owner API | Authorized conversation job and safe source event | Respect consent/channel/account access; no PII or delivery tokens in 3D |
| Project Manager owner API | Run/step state and canonical project/mission links | A PM import run is **not** a universal live agent presence feed |
| Approval owner API | Authorized pending decision and step reference | Existing action classes/state are **not** the proposed L1–L4 ladder |
| Marketing / CRM owner APIs | Authorized campaign or follow-up references | Active Campaign != running Marketing AI; open human SalesTask != executing AI |

Those Server-side modules and routes are source candidates for their respective Zuri API owners, not Visual Office dependencies. The Office consumes only reviewed, authorized API contracts; it does not import server code, query domain databases, or read the event broker directly. Source existence is **not** API availability or production-readiness evidence.

### 3.2 Snapshot contract — candidate

No Visual Office snapshot route, endpoint path, request DTO, response DTO, or version is approved. An earlier candidate route sketch, `GET /api/virtual-hq/snapshot`, is withdrawn and must not be implemented as a Zuri route based on this plan. Before connecting, Zuri owners must publish a versioned authorized context/domain/agent read contract with the source, freshness, bounds, permission behavior, and explicit unavailable/partial states the client needs. The Office may map that contract into a local view model; the mapping is not a second API contract.

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

- Polling, SSE, or another push transport is not selected here. The Zuri owner contract must define the transport, cadence, rate limits, ordering, reconnect and freshness behavior.
- No candidate `GET /api/virtual-hq/events` path or event DTO is approved. The Office consumes updates only through the documented Zuri interface and never connects directly to a broker.
- The client de-duplicates if required by the owner contract, ignores older observations, resynchronizes after gaps and scope changes, and enters `STALE` after the contract's source-specific freshness limit.
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

## 7. Visual Office client boundary

Visual Office remains in its own frontend repository and deployable. It owns the building renderer, floor navigation, Design Studio, local editing draft, and conversion of approved Zuri responses to presentation state. Zuri owns authentication, scope selection, authorization, business/domain/agent data, commands, audit, shared scene resources if adopted, and any event delivery.

The client boundary contains a registered-client sign-in/launch flow, a typed adapter for published Zuri APIs, a floor projection view, the Three.js scene and the 2D/accessibility fallback. It has no server/database tier for shared business state, no domain charter or Zuri route of its own, and no direct integration to domain modules. A Zuri-owned facade may aggregate reads only if the platform owners publish that boundary; this plan does not create or name it.

Keep the current Visual Office renderer and asset manifest as the implementation source. Any library/runtime upgrade must be checked against that repository's actual React and browser support rather than inferred from Zuri Server dependencies.

## 8. Delivery order, dependency and verification gates

| Canonical task | Refined delivery | Existing dependency | Proof required |
|---|---|---|---|
| `TASK-ZAI-019` | Client scene/GLB/orthographic camera/avatar/desk and domain-floor empty state | `TASK-ZAI-012` | Scene, floor projection, asset and client-route tests |
| `TASK-ZAI-020` | Authorized Zuri Business/domain/Agent/Mission/Approval reads in the optional client | `TASK-ZAI-019` | Published API contract, source provenance, cross-scope denial |
| `TASK-ZAI-021` | Keyboard, reduced-motion, mobile/fallback | `TASK-ZAI-019` | A11y + responsive E2E |
| `TASK-ZAI-022` | Freshness, live presence, owner-approved status transport, speech bubble & animations | `TASK-ZAI-020` | Real agent turn; contract-defined ordering/reconnect/stale E2E |
| `TASK-ZAI-023` | Approved L1–L4 queue and governed action | `TASK-ZAI-011`, `TASK-ZAI-022` | Authority, audit equivalence, denial + step-up E2E |

**Safe parallel prototype:** Isometric scene, GLB tests and avatar animations may use labeled design fixtures in isolated previews, but such fixtures never ship as live status and do not satisfy TASK-ZAI-019 or TASK-ZAI-022 source-backed acceptance. The mission feed and approval ladder remain blocking delivery dependencies unless re-reviewed under existing governance.

**Tests to implement when code is authorized:** contract tests against published Zuri API schemas; client mapping for partial/unknown/stale data; exact floor projection including zero-agent domains; scope denial; asset loading and cleanup; WebGL fallback; RTL/Thai text wrapping; reduced-motion/keyboard/mobile; contract-defined update ordering/reconnect; owner API audit equivalence for any allowed command; no direct domain write and no raw secret/PII disclosure. Run checks in the Visual Office repository and Zuri contract suite as the owners define them; do not use Zuri Server tests as evidence for the separate client. A live acceptance claim needs a real authorized Zuri test Business and agent trace. Report results by environment; never infer passes from design review.

## 9. Open decisions before implementation

1. **Business Visual Office topology:** ADR-026 covers coding-agent lanes; choose Business AgentInstance/Mission/Desk identity and queue/presence owner separately.
2. **Source of truth for presence:** define positive IDLE evidence, heartbeat, leases, event sequence/freshness budget and source priority. The current Agent Trace is not a generic scheduler.
3. **L1–L4 approval:** align planned TASK-ZAI-010/011 with existing PM approval classes without asserting equivalence.
4. **Scene persistence:** identify whether a Zuri-owned presentation resource/API will support shared saves and define revision, conflict, idempotency and audit behavior. Until that contract is approved, Studio changes remain browser-local drafts and JSON exports; no Visual Office database, new Zuri table or migration is assumed.
5. **Rendering choice and metrics:** profile bare Three.js versus React Three Fiber on mobile with measurable asset/FPS/memory budgets.
6. **Client registration and launch:** publish the approved auth/session/callback and Business-selection contract, allowed origins, least-privilege scopes, expiry and revocation rules.
7. **Shared asset catalog:** determine whether the bundled curated manifest is sufficient for the first slice. A searchable shared catalog or object-storage workflow requires its own Zuri owner, lifecycle and API contract.

## 10. Document/evidence state

- This elaboration records the owner's product-topology approval but changes **no code, client registration, API route, table, migration, runtime, identity, requirement, canonical approval record, roadmap status or acceptance checkbox**.
- It does not mark any task or delivery gate passed, and does not override the canonical [ROADMAP.md](../roadmap/ROADMAP.md).
- If this proposal changes system behavior, migrate/review the required canonical FR/NFR/SDD/ADR records first; do not hand-edit generated PRD/FEATURES exports.
- At implementation time review `AGENTS.md`, `CLAUDE.md`, [verification policy](../architecture/VERIFICATION-POLICY.md), domain charters, the exact source revision, and run the required document registry/graph/views/governance chain and actual tests.

**Version diff 0.0 → 0.1.0 (2026-10-09):** Candidate design elaboration mapping the Three.js/T3/animation inspiration into existing Zuri Visual Office tasks; source-of-truth, scope, identity, approval and test gates unchanged.

**Version diff 0.1.0 → 0.2.0 (2026-10-23):** Reconciles the owner-approved optional registered-client topology; makes one floor per authorized visible leaf domain explicit; removes unapproved Zuri route/DTO/transport sketches and Server-module coupling; gates live reads, commands and shared scene saves on owner-published contracts; removes the implied requirement for new Visual Office persistence tables. Canonical roadmap statuses and task evidence remain unchanged.
