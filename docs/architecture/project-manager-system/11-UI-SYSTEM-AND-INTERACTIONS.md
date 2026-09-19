---
id: ZAI:PM-UI-SPEC
title: Project Manager UI system and interaction specification
version: "0.1.0b"
status: candidate
created_at: "2026-09-16T01:24:00+07:00,RWANG,base 087f30258a6831865afd751e28804e36505aff30"
last_update: "2026-09-16T02:02:42+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: UI composition, forms, interaction and accessibility
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
---

# UI system & interactions

**Candidate · C-3 · architecture risk HIGH; UI delivery MEDIUM.** This document supplements the accepted [UI Design System](../../UI-DESIGN-SYSTEM.md), [navigation refinement](09-NAVIGATION-REFINEMENT.md) and [UX strategy](10-UX-STRATEGY-AND-JOURNEYS.md). It changes no application component. WF/FORM/UI identifiers are local proposal references, not newly registered canonical requirements.

## 1. Visual direction

Zuri Heritage: dark contextual navigation, warm amber emphasis, calm neutral workspace, explicit scope and evidence. Keep business content legible in Thai and English. The reference images inform the clear journey and vertical form rhythm, not a skincare theme or an assumed measured benefit.

Use the existing semantic-token/component-alias hierarchy; resolve the proposed role choices below during implementation. Do not copy raw hex values into every product component.

| Role | Proposed usage |
|---|---|
| Global shell | Existing Group → Organization → Business controls and domain bar; Project is a URL-resolved resource |
| Contextual sidebar | 240 px desktop starting width; Development at Business level; current project inside project routes |
| Project header | Breadcrumb, project name/code, authorized scope, latest evidence status, Import Plan action |
| Page heading | H1 + one-line purpose, optional scope summary; one primary action per action group |
| Work view row | Only inside Work; Work Items, Board, Structure Plan, Timeline, Milestones & Gates, Dependencies, Roadmap, planned Calendar |
| Page canvas | Neutral surface; 24 px desktop / 16 px narrow padding; content max 1440 px except graph/table workspace |
| Detail inspector | 320–400 px desktop column; full-width panel/drawer when narrow |
| Forms | Single column, max 640 px; semantic fieldsets and progressive disclosure |
| Graph workspace | Toolbar, visible edge legend, canvas, selection inspector, synchronized accessible node/edge list |
| Feedback | Inline field errors; page summary; persistent receipt/status for writes; toast only for supplementary feedback |

The review artifact has its own screen/state controls outside the product frame. These controls are documentation tools; they are not proposed product navigation.

## 2. Tokens and type

| Token family | Values / application |
|---|---|
| Brand | #E8820C primary, #F09420 hover, #B86A08 dark, #FDE8D0 tint, #FFF8F0 warm surface |
| Surface | #F7F8FA canvas, #FFFFFF card, #EFF1F3 secondary surface |
| Text | #1F2937 primary; #6B7280 secondary on white |
| Navigation | rgba(31,41,55,0.98); light labels, amber active destination with dark text |
| Information | #D6ECFA background; #1F2937 body text; #3D7A9E decorative accent |
| Font | IBM Plex Sans Thai, Manrope, Segoe UI, Tahoma, sans-serif; local availability/fallback must be verified |
| H1 / H2 / H3 | 28/36 at 650; 24/32 at 650; 20/28 at 600 |
| Body / label / caption | 14/22; 13/20; 12/18 px. Caption does not carry an essential instruction alone |
| Spacing | 4 px grid: 4,8,12,16,20,24,32,40,48,64,80,96 |
| Radius | Controls 8; cards 12; dialogs 16; badges 6 px |
| Icons | lucide-react, paired with text for navigation; icon-only controls have accessible names |
| Focus | 2 px visible high-contrast outline, 2 px offset; not hidden by sticky panels |
| Touch | At least 44 × 44 CSS px for primary touch controls and navigation |

### Contrast decisions

Calculated with the standard sRGB relative-luminance formula, rounded here for reading; compare unrounded ratios in checks.

| Pair | Ratio | Decision |
|---|---:|---|
| #1F2937 on white | 14.68:1 | Primary body text |
| #6B7280 on white | 4.83:1 | Secondary text on this background |
| #1F2937 on amber #E8820C | 5.33:1 | Primary button text |
| White on amber #E8820C | 2.75:1 | Do not use for essential text |
| #B86A08 on white | 4.12:1 | Do not use for normal-size body links |
| #3D7A9E on #D6ECFA | 3.85:1 | Use dark ink for information body text |

Normal text targets at least 4.5:1; large text 3:1. Color alone must not identify status or edge type. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

The 44 px touch target is a Zuri design choice. WCAG 2.2 AA Target Size Minimum specifies 24 × 24 CSS px with exceptions; this is not a claim that every WCAG criterion uses 44 px. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

These findings propose semantic usage for new screens. They do not certify or silently alter all existing product components.

## 3. Reusable components and behavior

| Local component | Contract |
|---|---|
| ScopeBreadcrumb | Scope kind + authorized display name + back link. Clear old content before cross-scope loading |
| DestinationNav | Single selected leaf, expandable labeled groups; active project Work keeps its sub-view selection |
| FilterBar | Search + relevant filters + reset + result count; authorized options only; changes reflected in shareable URL without secrets |
| EvidenceMetric | Value + unit + strategy + source timestamp. UNKNOWN stays UNKNOWN; no fabricated zero |
| DomainCard | Domain key/name, accountable owner, charter, affected features, risks/evidence. Opens Domain detail |
| FeatureRow | Feature ID/outcome, owner, contributing domains, requirement readiness, next acceptance gate |
| WorkTable | Semantic table with column headers and row links; optional selection only when an authorized bulk action exists |
| VersionBadge | Draft/reviewed/approved/superseded with immutable version/hash link; never a generic green “done” |
| TypedGraphEdge | Arrowhead + text label + line style; owner/contract in inspector; keyboard equivalent via list |
| OperationPanel | Method/path, operationId, owner, schema, auth, examples, error responses, linked requirement |
| RunTimeline | Run/attempt IDs, timestamps, executor heartbeat, event cursor; command receipt distinct from final state |
| ReviewPanel | Resource/version/hash, scope, proposed effect, evidence, expiry, decision/reason; explicit decision result |
| SecretInput | Write-only in product; no prefilled value, saved draft, telemetry or URL; disabled synthetic field in artifact |
| ErrorSummary | Focusable summary with linked field errors, useful cause, retry/recovery action, safe correlation ID |
| EmptyState | What is empty and why; authorized next step; filtered-empty includes Clear filters |
| ReadinessStrip | Docs / implemented / tested / deployed / activated are separate evidence stages |

## 4. Form anatomy and validation

Reading order: **title and purpose → scope/version → fieldset → review summary → action → receipt**.

- Labels sit above and associate programmatically with controls. Help text is linked with aria-describedby. Placeholder is an example, not the only label. [W3C form-label guidance](https://www.w3.org/WAI/tutorials/forms/labels/)
- State requiredness in text, mark optional fields “ไม่บังคับ”; conditionally required fields explain the condition. Do not show a field as optional once its chosen profile requires it.
- Validate after a touched field loses focus and on explicit Preview/Submit. Do not announce errors on every keystroke.
- On failed submission, keep non-secret values and move focus to the error summary; links focus the offending field. Use specific copy: “กรุณาเลือก Workspace สำหรับโปรเจกต์นี้”.
- Required arrays may be present and empty where the contract permits it. A required property is not automatically a nonempty collection; preserve minItems and minLength semantics.
- Identifier/name, Domain/Feature, connection/model and provider credential/client key stay separate. Combine fields only when the data contract and user job support one semantic value.
- Dates show format and timezone. User-facing target dates stay dates; run/review expiry timestamps serialize with offset/UTC per API, with timezone visible.
- Unsaved non-secret changes use an explicit leave/discard choice. Restore a draft only after scope and version are reauthorized. No credential, one-time key, raw imported secret or sensitive prompt autosave.
- Disable duplicate submission while awaiting a durable command receipt. An offline/timeout response does not prove the command had no effect; use idempotency lookup/reconciliation.
- Creation and amendment are distinct: approved agent/fleet/workflow versions cannot be edited in place. “Create next draft” makes a new revision.
- Large arrays use labeled add/remove rows or searchable authorized reference pickers. Schema/workflow editors provide structured fields and validation, with optional source view; no arbitrary shell-command field.

The 13 field inventories, 83 field bindings, requiredness, enums and bounds are maintained in [UX/UI candidate model](contracts/ux-ui.candidate.json) and readable tables in [screen specs](12-WIREFRAMES-AND-SCREEN-SPECS.md). Runtime server validation remains authoritative.

### Conditional provider and MCP forms

| Profile | Visible required data | Outcome/review |
|---|---|---|
| Connection | Existing provider, display name, purpose, authorized network profile | Connection metadata draft |
| Cloud/private model | Connection, executionLocation, protocolProfile, policy version, identifier/revision/capabilities; endpoint according to provider/network profile | Capability/auth/network probe; result with timestamp, never “healthy” on save alone |
| Paired model executor | Enrolled executor selection plus model/profile/policy; no browser-localhost assumption | Reachability via authorized executor; offline state remains visible |
| MCP STREAMABLE_HTTP | Registered connection, endpoint, auth profile, pinned protocol, discovered tool schema and explicit allowed tool IDs | Review tool/capability diff before binding |
| MCP STDIO | Enrolled executor profile, pinned packaged launcher/tool snapshot, allowed tools and auth profile | No free-form executable command or arbitrary script import |
| Provider API credential | Existing connection, write-only key and reason | Stored through secret-store boundary; return metadata only |
| Inference client key | Name, Project grant, model allowlist, expiry, rate/token quota, reason | New key shown once only after confirmed creation; metadata/revoke thereafter |

The OpenAPI's flat optional endpoint/executor properties do not encode all cross-field rules. The UI model marks the profile conditions; final server validators and negative contract tests must enforce them at P3. Endpoint format alone does not authorize a network probe. A CLOUD provider may supply a fixed endpoint through its provider profile; do not force a duplicated user-entered URL when that profile is authoritative.

FORM-CREDENTIAL documents the API-key credential profile. OAuth client credentials use the separate API schema and need a profile-specific field review before that implementation; the API-key wireframe does not claim OAuth onboarding is fully designed.

### Contract gate for Business policy administration

The 72-operation OpenAPI inventory defines Project-scoped ReviewInput with six resource types. It does not define a Business routing/budget policy review operation. WF-37 therefore inspects authorized policy references and constraints; its edit/approve action remains unavailable. Before P3 enables policy administration, bind an existing owner contract proven by source enumeration or propose the missing Business contract and tests. Do not route a Business policy through Project reviews. Executor enroll/revoke controls likewise require their owner endpoint/port binding; the claim/heartbeat contract is not an enrollment API.

## 5. State and recovery matrix

| State | Display | Allowed behavior |
|---|---|---|
| Loading | Scope-safe skeleton and readable loading status; preserve heading | Cancel navigation; no stale cross-project rows |
| Ready | Actual authorized data, source/version/timestamp | Actions according to grant and lifecycle |
| Empty | Explain missing data, filtered empty or not configured | Clear filter or first authorized create/bind action |
| Error | Useful failure, safe request reference, retained non-secret input | Retry read; reconcile uncertain writes |
| Forbidden | Generic access-unavailable screen, no resource metadata/counts | Return to an authorized context; never expose hidden object title |
| Stale | Last confirmed value/time + disconnected stream/refresh status | Reconnect/read refresh; risky state-changing controls gated |
| Conflict | Base/current revisions and safe diff, retained draft | Reload/compare/rebase; no silent overwrite |
| Validation | Linked summary + inline cause; incomplete graph/schema markers | Correct draft; validation success does not create a run |
| Rate/budget limited | Limit scope, reset/availability when supplied | Wait/change authorized plan; no silent provider bypass |
| UNKNOWN effect | Submitted command ID, last event, reconciliation evidence | Query outcome or reviewer resolution; no automatic retry |

Loading/empty/error/forbidden apply to every read surface. Conflict/validation apply where edits, grants or imports exist. The review artifact can inject global scenarios for inspection, but a real read-only table must not gain edit controls merely because “conflict” was selected.

## 6. Responsive and keyboard specification

| Width/condition | Composition |
|---|---|
| ≥1280 | Context sidebar + fluid content; graph inspector may share row |
| 1024–1279 | Context sidebar; secondary panels stack when content minimum would be violated |
| 768–1023 | Drawer navigation, full labels; top actions wrap; details stack |
| <768 | One main content column, drawer, 16 px gutter; forms full width; no page-wide horizontal scrolling |
| Dense table/graph | Contained horizontal scroll or pan with visible access; table/list alternative stays available |
| 200% browser zoom | Reflow based on effective CSS viewport; no obscured focus or essential control |
| Reduced motion | Remove nonessential movement; status changes remain readable |

Drawer: opener has expanded/controls attributes; move focus inside on open, trap focus while modal, Escape closes, restore opener focus after close. Review modal follows the same behavior. Nonmodal inspector does not trap focus. Search/result updates use polite status; urgent errors use a bounded alert. Live run streams group announcements to avoid overwhelming screen readers.

Keyboard graphs: enter through a named region, select nodes/edges through an adjacent semantic list, inspect text properties, change selection without requiring pointer dragging. Drag reorder/connect has an equivalent structured edit. Pan/zoom must not block page keyboard navigation.

Tests must cover Thai wrapping, long repository paths/IDs, 390 px mobile, 756 px narrow layout and actual browser zoom/assistive technology at implementation. Width emulation alone is not a 200% zoom certification.

## 7. Copy and permission model

Use outcome labels: “ดูผลตรวจ”, “ตรวจแผนก่อนนำเข้า”, “สร้างเวอร์ชันร่าง”, “ขออนุมัติ”, “ตรวจสอบผลคำสั่ง”. Avoid generic Submit where the effect is consequential. Show disabled reasons only when the viewer may know the resource exists; hide forbidden destination metadata otherwise.

Status examples:
- “รอผลยืนยันจาก executor” for unknown effect, not “Failed”.
- “คำสั่งได้รับแล้ว • รอประมวลผล” after durable receipt, not “เสร็จแล้ว”.
- “ยังไม่มีหลักฐาน deploy สำหรับ revision นี้” when code/test evidence exists.
- “ข้อมูลล่าสุด 14:20 • กำลังเชื่อมต่อใหม่” for stale stream.

Review screens expose proposed screens for documentation. Product navigation exposes only implemented and authorized destinations, following NAV-D7. Shared artifact previews must show audience/expiry/redaction before publication; public sharing is a separate authorized action.

## 8. UI acceptance — PLANNED / NOT_RUN for product

| ID | Acceptance |
|---|---|
| UI-T01 | Every one of 41 PM destinations plus the shared Business registry entry resolves to a screen family, scope and release slice |
| UI-T02 | Domain and Feature have distinct content/filters; shared work is not double counted |
| UI-T03 | Form property names/requiredness/enums match the pinned API or existing objective-first source |
| UI-T04 | Conditional provider/MCP fields follow selected profile; hidden stale values are not sent |
| UI-T05 | Validation preserves non-secret values and focuses linked error summary; secrets excluded from drafts/export |
| UI-T06 | All reads have loading/empty/error/denied behavior; edits add conflict and reconciliation |
| UI-T07 | Tab/Shift+Tab/Escape, drawer focus restoration and graph list alternative work |
| UI-T08 | 390 px, 756 px, desktop and 200% zoom retain scope, primary action, readable fields and contained tables |
| UI-T09 | Contrast checked for final component states including focus/disabled; status never color-only |
| UI-T10 | Approval binds exact hash/revision/scope; stale review cannot authorize new content |
| UI-T11 | Provider secret and client API key have separate authority/lifecycles; one-time reveal not persisted |
| UI-T12 | Run status, acceptance, CI, deploy and activation evidence remain separate |
| UI-T13 | Existing objective-first intake, Work views, 7 modes and old URLs remain reachable after NAV-P1 |
| UI-T14 | Product actions are tested through real API/receipt/evidence flows; artifact clicks are not counted as product tests |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Heritage tokens, component contracts, form semantics, state/recovery, responsive behavior and 14 UI acceptance scenarios | base 087f3025 | RWANG |
