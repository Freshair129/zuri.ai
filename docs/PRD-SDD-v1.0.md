# Zuri V2 — Project Manager Module: PRD & SDD

> **Scope of this document: the Project Manager module of Zuri V2**, not the whole
> product. What V2 is as a product — its surfaces, scope chain and non-negotiables —
> is `../../docs/PRODUCT.md` (Layer 0). The live index of every feature is
> `FEATURE-MAP.md` (generated). Structure set by ADR-004.

| Field | Value |
|-------|-------|
| **Version** | 1.44.0b |
| **Status** | Draft |
| **Author** | Owen (etohcolsgroup) + Claude (RWANG doc-architect) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-15 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-11 | Owen + Claude | Initial creation via RWANG doc-architect — merged from spec pack (`D:\zuri-ai\docs`) + build docs |
| 1.0.1 | 2026-08-12 | Claude | FR-017 (UI wizard), FR-018 (Excel intake), FR-020 (adaptive shell) delivered → ✅ |
| 1.0.2 | 2026-08-12 | Claude | FR-019 (Enterprise API: ExternalRef, envelope 1.1, OpenAPI from Zod) → ✅ — intake phase complete |
| 1.0.3 | 2026-08-12 | Claude | ADR-003 fallout: SDD-001 superseded; SEC-004 flagged as about to become false; SEC-005 raised to P0; SDD-008 risk recorded |
| 1.1.0 | 2026-08-12 | Claude | ADR-004: rescoped as the Project Manager **module** of V2; feature notes moved to `features/`; ids unchanged |
| 1.2.0 | 2026-08-12 | Claude | FR-021 (identity primitive: ExternalIdentity + resolveLineIdentity) ✅; FR-022 (full LINE identity provider) 🔜 — ADR-007 P3 |
| 1.3.0 | 2026-08-12 | Claude | FR-023 (Zuri Backend Slice CRM core: Customer/Conversation/Message + LINE ingest) ✅ — ADR-007 P2 |
| 1.4.0 | 2026-08-12 | Claude | FR-022 (full P3 identity gate: account linking + PDPA erase-revoke + staff/customer split + `resolveLinePrincipal`) ✅ — ADR-007 P3 complete |
| 1.5.0 | 2026-08-12 | Claude | FR-024 (P5 knowledge projection: relations→graph, live-facts guard, `queryKnowledge`) + FR-025 (P6 agent read-only context contract, Gate E) ✅ — built as two parallel tracks over the shared P3 gate |
| 1.6.0 | 2026-08-12 | Claude | FR-026 (P7 Gate F agent write/action gate: RBAC + ownership + sensitivity authorization, single-use step-up, audited transactional execute) ✅ — the Gate E→F boundary |
| 1.7.0 | 2026-08-12 | Claude | FR-027 (P7 end-to-end agent turn: `handleAgentTurn` composing ingest→read context→optional Gate F action→response) ✅ — the full LINE→Identity→Knowledge→Agent→Tool→response path |
| 1.8.0 | 2026-08-12 | Claude | FR-028 (LINE webhook API route → `handleAgentTurn`, tenant-scoped) ✅ + MSP memory port (real `msp_memory_upsert`/`_list`, principal-keyed, fail-closed) + GenesisBlockDB sink (real NAPI `addNode`/`addEdge`, live-fact guarded) wired into the stack |
| 1.9.0 | 2026-08-12 | Claude | FR-029 (agent runtime ports: `createAgentPorts` binds the agent to real MSP memory + GenesisBlockDB knowledge, injectable, graceful fallback) ✅ — the agent now genuinely runs on MSP + GKS when configured |
| 1.10.0 | 2026-08-12 | Claude | FR-030 (P4 persistence: Postgres/Supabase-ready — generated `schema.postgres.prisma` + init DDL, `assertDbBoundary` Zuri≠MSP, UUID-preserving snapshot cutover) ✅ — Gate D groundwork; live provisioning is owner-run |
| 1.11.0 | 2026-08-13 | ATHER | NFR-008 + SDD-010: Zuri Heritage v2 token, accessibility, component-state, and V1-compatible migration contract (ADR-010) |
| 1.12.0 | 2026-08-13 | ATHER | FR-031: RBAC viewer gate seam (`resolveViewer`) for the ADR-008 entry journey |
| 1.13.0 | 2026-08-13 | ATHER | FR-032: viewer-gated Home entry chooses group/business scope before Overview |
| 1.14.0 | 2026-08-13 | ATHER | FR-033: Topbar scope dropdowns removed; Home and later breadcrumb own scope switching |
| 1.15.0 | 2026-08-13 | ATHER | FR-034: breadcrumb becomes the page-based Group/Business, Workspace, and Project switcher |
| 1.16.0 | 2026-08-13 | ATHER | FR-035: split Group consolidation from cross-domain Business Overview |
| 1.17.0 | 2026-08-13 | ATHER | FR-036: Project Team manager over scoped Membership with assignee load |
| 1.18.0 | 2026-08-13 | ATHER | FR-037: Project Files metadata manager with ProjectFile schema and additive migration artifact |
| 1.19.0 | 2026-08-13 | ATHER | FR-038: My Profile plus owner-gated users and per-domain Membership permissions |
| 1.20.0 | 2026-08-13 | ATHER | FR-039 + SDD-018: Business-bound shell context (`Workspace > Organization > Business`), Development domain, and no deep shell scope |
| 1.21.0 | 2026-08-13 | ATHER | Proposed FR-040 + SDD-019: Project Work views, separating the project-local Structure Plan and Dependency Map from the cross-project Development dependency register |
| 1.22.0 | 2026-08-13 | ATHER | FR-040 + SDD-019 implementation: Project Work shell, canonical Structure Plan, contained Dependency Map read model, and release-gate evidence (G5 remains open on the existing Prisma test bootstrap error) |
| 1.23.0 | 2026-08-13 | ATHER | FR-040 G5 closure: Prisma test bootstrap repair; full 48-file / 278-test suite, build, browser proof, and documentation gates pass |
| 1.24.0 | 2026-08-13 | ATHER | FR-041/042 + ADR-013: Business-first Overview with Roadmap/Goals and HR / People as a peer domain |
| 1.25.0 | 2026-08-13 | ATHER | FR-043 + ADR-014: direct Project Business ownership with Space as secondary Development context |
| 1.26.0 | 2026-08-13 | ATHER | Planned FR-044 + SDD-022: minimal Landing/Login stubs, pre-shell Business Routing, and guarded BusinessShell entry |
| 1.27.0 | 2026-08-13 | ATHER | FR-044 implementation: provider-only root, EntryShell, Business Routing, guarded BusinessShell, browser proof, and release gates ✅ |
| 1.28.0 | 2026-08-14 | ATHER | Proposed FR-045 + NFR-009 + BR-010 + SEC-007 + SDD-023: SQLite-authoritative managed local files, rebuildable cache, migration/rollback and local capability boundary (ADR-016 / ZV2-CR-001) |
| 1.29.0 | 2026-08-14 | ATHER | Owner-approved FR-045 foundation: W0 inventory, W1 additive schema, W2 contained filesystem port and W3 isolated File Manager read model; W4-W8 remain |
| 1.30.0 | 2026-08-14 | ATHER | FR-045 W4-W9 implemented: managed file APIs/UI, reconcile/cache, local reveal, portable backup/remount, all AC and retained-reference W9 decision |
| 1.31.0 | 2026-08-14 | ATHER | Proposed FR-046 + SDD-024 + SEC-008: trusted request viewer and minimal viewer-scoped `/api/entry`; truth-synced merged FR-043/045 evidence |

| 1.31.1 | 2026-08-14 | ATHER | FR-046 implemented: trusted request-session seam, minimized `/api/entry`, explicit local demo session, protected-route migration and cross-tenant/browser proof |
| 1.32.0 | 2026-08-14 | ATHER | Owner-approved Phase 1 LINE business agent: FR-047..050 + NFR-010 + BR-011 + SEC-009 + SDD-025; curated SmartGift knowledge, provider port, grounded answer and single-reply delivery |
| 1.33.0 | 2026-08-14 | ATHER | Owner-approved ADR-018 / ZV2-CR-004 local implementation: FR-051..052 + NFR-011 + BR-012 + SEC-010 + SDD-026; production remains gated on remote inventory, backup and credentials |
| 1.34.0 | 2026-08-14 | ATHER | Production Supabase migrations and approved 74-row SmartGift import verified; LINE binding remains credential-free and PENDING |
| 1.35.0 | 2026-08-14 | ATHER | Integrated FR-046 entry authority with FR-051/052 production Supabase isolation without changing requirement identities or applied migration history |
| 1.36.0 | 2026-08-14 | ATHER | Owner-approved production-disabled merge boundary for FR-051/052; runtime secret, live isolation, backup policy, provider evaluation and LINE canary remain activation gates |
| 1.37.0 | 2026-08-14 | ATHER | Owner-approved FR-053/054 Activation Readiness Pack with golden evaluation, live-role isolation probe and dry-run canary contracts; production traffic remains disabled |
| 1.38.0 | 2026-08-14 | ATHER | FR-053/054 readiness tooling implemented and regression-tested; fake evaluation passes 20/20 while real provider, live login probe and signed LINE canary remain NOT_RUN |
| 1.38.1 | 2026-08-14 | ATHER | Activation truth-sync: FR-047..050 implementation is active, but production acceptance remains blocked by A1/A2/A3 evidence gates |
| 1.39.0 | 2026-08-14 | ATHER | Owner-approved FR-054 probe remediation: deployed text identifiers, OID privilege inspection and PostgreSQL 17 role/RLS regression; live production gate remains NOT_RUN |
| 1.40.0 | 2026-08-14 | ATHER | Owner-approved FR-055 controlled activation and receipt boundary: routing-first rollback, truthful receipt semantics and dedicated operator role (ADR-020) |
| 1.41.0 | 2026-08-14 | ATHER | Secret-redacted live dedicated-login isolation passes the exact 74-row Supabase scope; provider, binding and LINE canary gates remain open |
| 1.42.0b | 2026-08-14 | ATHER | Reconciled later branch facts: Zuri Landing is retained as FR-056/SDD-029/ADR-021, and the PlanEnvelope seven-mode/edit-only intake updates remain documented |
| 1.43.0b | 2026-08-15 | ATHER | PR #12 semantic conflict repair: MSP authorization is FR-057/NFR-014/BR-015/SDD-030/SEC-013/ADR-022 while Phase 1 production IDs retain their meanings |
| 1.44.0b | 2026-08-15 | ATHER | Approved FR-057 API-010 canonical GoVibe/MSP vault resolution; legacy API-009 scopeKey access is explicit compatibility mode only |

## Referenced Standards

- IEEE 29148-2018 (Requirements Engineering)
- IEEE 1016-2009 (Software Design Description)
- ISO/IEC 42001 (AI management — Layer 3 only)

## Source documents (merged, still authoritative for detail)

Spec pack: `../../docs/` — START-HERE, AGENTS.md, ADR-001, ARCHITECTURE, DOMAIN-MODEL,
EXECUTION-MODES, IMPLEMENTATION-PLAN, ACCEPTANCE-CRITERIA, TEST-PLAN, UI-DESIGN-SYSTEM,
ROUTES-SITEMAP, INTEGRATION-MAP-ZURI, ZURI-V2-HANDOFF.
Build docs: `ARCHITECTURE-NOTES.md`, `DB-MIGRATION-NOTES.md`, `ZURI-INTEGRATION-ASSESSMENT.md`,
`features/FR-020-adaptive-shell.md`, `features/FR-019-enterprise-api.md`, `../.agent/reports/FINAL.md`.

---

# Layer 1 — Product Requirements (PRD)

## 1.1 Executive summary

Offline-first Project Manager ที่รองรับ business execution และ software execution
ในระบบเดียว — ธุรกิจหนึ่งโปรเจกต์ผสม workstream ได้ 7 โหมด (Software Sprint,
Data Migration, B2B Sales, B2C Campaign, Product Launch, Operations, Business
Expansion) บนโมเดลข้อมูลกลางตัวเดียว — เป็น**โมดูลแรกของ Zuri V2** ที่สร้างเสร็จก่อน
โมดูลอื่นที่จะยกมาจาก V1 (ADR-003: V2 มาแทน V1 ด้วยการ reuse)

## 1.2 Personas & use cases

| Persona | Use case หลัก | อ้างอิง |
|---|---|---|
| Owen A — เจ้าของธุรกิจเดียว | เข้าแอปเห็นงานทันที, สร้างโปรเจกต์จากเป้าหมาย, ไม่เจอศัพท์โครงสร้าง | features/FR-020-adaptive-shell.md (stories A1–A4) |
| Owen B — เจ้าของหลายธุรกิจ | Portfolio overview, สลับธุรกิจ 1 คลิก, isolation ระหว่างธุรกิจ, งานข้ามธุรกิจ | เดียวกัน (stories B1–B5) |
| ผู้ใช้กระดาษ/Excel | ดาวน์โหลด template → กรอก → อัปโหลด → dry run รายแถว | v0.1 pattern (`import-data/`) |
| Enterprise integrator | upsert ผ่าน API ด้วย external ID ของระบบตัวเอง ไม่ใช้ UI | features/FR-019-enterprise-api.md |
| Planning agent | ส่ง PlanEnvelope JSON เข้า pipeline import | contracts/plan-envelope.schema.json |

## 1.3 Functional requirements

สถานะ: ✅ = implemented + tested, 🔜 = specified, not built

| ID | Requirement | สถานะ |
|---|---|---|
| FR-001 | จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes) | ✅ |
| FR-002 | Scope selectors (Portfolio·Business·Workspace·Project) + จำ selection ล่าสุด | ✅ |
| FR-003 | Project CRUD + archive (soft delete) + mixed execution modes | ✅ |
| FR-004 | Workstream CRUD: executionMode + progressStrategy + progressWeight | ✅ |
| FR-005 | Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics) | ✅ |
| FR-006 | Milestones + Gates (weighted, required flag, evidence JSON) | ✅ |
| FR-007 | Dependencies 5 ชนิด, กัน self/cycle, ประเมิน blocked/ready | ✅ |
| FR-008 | Repository records (local metadata) + ผูกโปรเจกต์แบบ many-to-many | ✅ |
| FR-009 | Execution views 7 โหมดบนโมเดลกลาง (global + project-scoped) | ✅ |
| FR-010 | Progress ต่อ workstream ตาม strategy + evidence + warnings + "Explain" UI | ✅ |
| FR-011 | Project roll-up ถ่วงน้ำหนัก Σ(ws%×w)/Σw | ✅ |
| FR-012 | PlanEnvelope import: validate → seven-mode semantic contract check → dry run → transactional commit → audit | ✅ |
| FR-013 | Snapshot backup: export + import แบบ preview-then-confirm | ✅ |
| FR-014 | Audit log (immutable) + UI browser | ✅ |
| FR-015 | Command palette (Ctrl+K), filters, search | ✅ |
| FR-016 | Seed/demo dataset idempotent ครบ 7 โหมด | ✅ |
| FR-017 | UI wizard intake ("เริ่มจากเป้าหมาย") → สร้าง envelope เข้า pipeline เดิม; direct modal creation is edit-only | ✅ |
| FR-018 | Excel template intake: generator จาก Zod schema + xlsx→envelope converter + error รายแถว | ✅ |
| FR-019 | Enterprise API: ExternalRef mapping + upsert-by-external-id + OpenAPI docs | ✅ |
| FR-020 | Adaptive shell ตามจำนวนธุรกิจ (single → ไม่มี switcher, multi → switcher + portfolio landing) | ✅ |
| FR-021 | Identity resolution: `ExternalIdentity` (LINE→Person, tenant-scoped) + `resolveLineIdentity` — idempotent, tenant-required, audited, revoke-aware (ADR-007 P3 foundation primitive) | ✅ |
| FR-022 | LINE as an identity provider end-to-end: account linking (single-use token → bind to existing Person, idempotent, merge-aware), PDPA erase-revoke, staff/customer split, and `resolveLinePrincipal` (the single P3 seam) — the full P3 gate on top of FR-021 | ✅ |
| FR-023 | Zuri Backend Slice CRM core (ADR-007 P2): Customer (per-tenant, linked to Person) + Conversation + Message + LINE gateway `ingestLineMessage` (resolves through FR-021, idempotent) | ✅ |
| FR-024 | Knowledge projection (ADR-007 P5): project Zuri **relations** (Customer/Business/Conversation/Membership) into a GKS/KG graph via a pluggable sink; **live facts (price, credit, invoice, payment, stock, schedule) are never projected** — they stay a Zuri query (`assertNoLiveFacts` guard). Tenant-scoped, deterministic, read-only. Exposes `queryKnowledge` (principal neighbourhood) as the contract the agent consumes | ✅ |
| FR-025 | Agent read-only context contract (ADR-007 P6, Gate E): `assembleAgentContext` binds a resolved principal (via the P3 gate) to Identity + MSP memory (**principal-keyed, not channel-keyed**) + GKS knowledge (FR-024) + Zuri **read-only** tools; a write-classified tool is refused at registration (Gate E→F boundary) | ✅ |
| FR-026 | Agent write/action gate (ADR-007 P7, Gate F): write tools in a **separate** registry (effect WRITE + executor); `authorizeAgentAction` decides by RBAC (Membership role) + resource ownership + sensitivity; **HIGH-sensitivity actions require a single-use step-up token**; `executeAgentAction` resolves the principal → authorizes → enforces step-up → runs the write in one transaction with an append-only audit. Read stays Gate E | ✅ |
| FR-027 | End-to-end agent turn (ADR-007 P7): `handleAgentTurn` composes the full path — LINE ingest (FR-023) → read context (FR-025) → optional Gate F action (FR-026) → response — over injectable memory/knowledge/tool ports; unauthorized/step-up-needed actions degrade to a graceful response, never a crash | ✅ |
| FR-028 | LINE webhook API route (ADR-007 P7 wiring): `POST /api/agent/line-webhook` normalizes LINE message events → `handleAgentTurn` (Gate E read/answer), tenant-scoped (refuses an unresolved tenant — no minting under a DEFAULT tenant); the zuri-cli LINE bot forwards webhook events here (two runtimes, HTTP seam, real E2E) | ✅ |
| FR-029 | Agent runtime ports (ADR-007 P6): `createAgentPorts` binds the agent to the REAL backends — MSP memory (`createMspMemoryPort`) + GenesisBlockDB knowledge (`createGraphKnowledgeReader`, the graph read side of P5) — as the injectable ports `assembleAgentContext`/`handleAgentTurn` consume; unconfigured backends degrade gracefully to in-memory/Prisma. MSP and GKS stay independent | ✅ |
| FR-030 | Persistence: Postgres/Supabase readiness (ADR-007 P4): generated `schema.postgres.prisma` + init DDL (provider swap only, models identical); `assertDbBoundary` enforces **Zuri DB ≠ MSP DB**; UUID-preserving cutover via the provider-agnostic backup snapshot (`db:pg:export`/`import`). DuckDB stays a cache/analytics tier, not the transactional store | ✅ |
| FR-031 | Viewer gate: `resolveViewer()` resolves the current principal into one role (`OWNER`, `MEMBER`, or platform `DEV`), `visibleBusinessIds`, and `visibleDomains` before the ADR-008 Home journey. DEV is an explicit platform grant, never a widened Membership; development fallback is OWNER-of-all only when no real principal exists. | ✅ |
| FR-032 | Home (`/`) is the ADR-008 entry journey: it shows only groups and businesses permitted by `resolveViewer()`, lets the user enter the Group (“all businesses”) or one Business scope, and then navigates to Overview. A single visible group skips the group choice. Creating a business remains the existing Settings flow. | ✅ |
| FR-033 | Topbar contains Zuri identity, the viewed-domain chip, ERP/PM lens toggle, command palette, New Project, and profile cluster—but no scope dropdown or selector. Scope choice begins at Home and moves to breadcrumb switching in the following slice. | ✅ |
| FR-034 | Breadcrumb is the scope switcher: its Group/Business crumb returns to Home (`/`), Workspace crumb opens `/workspaces`, and Project crumb opens `/projects`. It labels Group versus Business correctly and uses the active ERP/PM lens; a single workspace omits its crumb. | ✅ |
| FR-035 | Overview is the selected Business's operational home: scoped execution KPIs, project health, strategy, and shortcuts to enabled V2 domains. A missing Business selection is an actionable Home state, never a Group card roll-up. | ✅ |
| FR-036 | Project Team (`/projects/{id}/team`) lists Memberships in the project’s business scope, adds/removes business-scoped members, changes Owner/Member role, and shows each member’s active WorkItem assignee load. Group-workspace memberships remain read-only because they are tenant-wide. | ✅ |
| FR-037 | Project Files (`/projects/{id}/files`) manages metadata references for documents and attachments linked to a Project and optionally a WorkItem. `ProjectFile` uses UUID + human code, validates a non-empty `url` or `blobRef`, and records every create/delete in audit. Binary upload/storage is outside the local MVP. | ✅ |
| FR-038 | My Profile (`/profile`) shows the resolved local account, language preference, LINE-link state, and local session. Users & Permissions (`/platform/users`) is OWNER-only and edits Membership role plus per-domain visibility; MEMBER receives no domain visibility unless explicitly granted, while OWNER/DEV retain role-bound all-domain access. | ✅ |
| FR-039 | The Base Context Bar maps `Portfolio > Tenant > Business` to `Workspace > Organization > Business` and stops global shell scope at Business. Schema Workspace and Project are Development resources, not shell or sidebar parents; Organization is a UI label for Tenant, whose UUID and isolation semantics remain unchanged. | ✅ |
| FR-040 | Project Work views: every Project provides a Structure Plan (WBS) and a project-local Dependency Map. Structure Plan renders the existing Project → Workstream → WorkContainer → WorkItem hierarchy. Dependency Map renders only dependency edges whose two endpoints both belong to the opened Project. The cross-project register remains Development → Dependencies. No new persistence model is introduced. | ✅ implemented; G5 passed |
| FR-041 | Business Overview renders the selected Business's Projects plus a Business Strategy read model: Roadmap and two or three ordered goal horizons. The service enforces horizon cardinality and viewer/business isolation; roadmap editing and Project links are a follow-up mutation slice. | ✅ |
| FR-042 | HR / People is a peer ERP domain (route key `people`) with a Business-scoped People Directory over Person/Membership. It is not nested under Development; Project Team remains Project-local. Attendance, leave, payroll, and performance are out of scope for this slice. | ✅ |
| FR-043 | Project stores a direct nullable `businessId` owner plus `workspaceId` as Development Space context. Business-scoped projects must match their Space owner; explicit portfolio/tenant shared projects remain null-owner and are never attributed to a Business Overview. | ✅ |
| FR-044 | Entry routing is split into a minimal Landing (`/`), a demo Login stub (`/login`), a Business Routing page (`/businesses`) that shows only viewer-visible Businesses, and the final BusinessShell (`/overview`) mounted only after a Business is selected. No real auth or new design tokens are included in this slice. | ✅ implemented |
| FR-045 | Managed local file workspace: SQLite is authoritative for FileAsset identity, Business/Project ownership, links, version, status and audit; the filesystem stores real content plus disposable cache. Business File Manager aggregates Business-owned and child Project assets without copying content. Existing FR-037 ProjectFile rows/routes migrate through a compatibility boundary; local OS reveal is capability-gated and hosted mode denies it. | ✅ implemented (beta); W0-W9 and AC-045-01..12 complete |
| FR-046 | Production viewer entry contract: Business Routing consumes one atomic, server-filtered `/api/entry` response derived from a trusted request session and `resolveViewer()`. Hidden Businesses and unrelated ancestry are never returned; missing sessions fail closed; client-supplied identity/role/platform claims are never authorization input. | ✅ implemented (beta); provider selection remains separately gated |

| FR-047 | Curated business-knowledge read contract: the SmartGift pilot exposes only an allow-listed, versioned public product projection through `BusinessKnowledgeReadPort`; DuckDB and Supabase are adapters. PII, cost, margin, invoice, unrestricted SQL and local paths are excluded. | Phase 1 active - owner-approved 2026-08-14 |
| FR-048 | Provider selection contract: `ModelProviderPort` normalizes OpenRouter OAuth credential references and API-key adapters for OpenAI, Anthropic, Gemini and Groq. Public LINE cannot select consumer-plan CLI credentials, and automatic fallback is disabled. | Phase 1 active - owner-approved 2026-08-14 |
| FR-049 | Evidence-grounded answer: classify into a registered knowledge query, send only a bounded evidence packet to the configured provider, reject unsupported numbers/facts, and return a deterministic Thai fallback when evidence or provider output is insufficient. | Phase 1 active - owner-approved 2026-08-14 |
| FR-050 | Single-reply LINE delivery: one signature-verified normalized event produces at most one model request and one LINE reply, with durable-or-explicitly-bounded dedupe, kill switch, bounded timeout and truthful `ACCEPTED_BY_LINE` receipt semantics. | Phase 1 active - owner-approved 2026-08-14 |
| FR-051 | Production Supabase tenant isolation: SmartGift knowledge lives in private `zuri_core`, every row carries the reserved Tenant and Business UUIDs, composite foreign keys enforce ancestry, forced RLS plus tenant-leading indexes protect reads, and the DuckDB import retains SHA-256 lineage plus an immutable import audit event. | Production migration and verified 74-row price-disabled import complete |
| FR-052 | Server-owned LINE scope binding: the webhook rejects client-selected Tenant/Business IDs and resolves scope only from an active, destination-bound, hash-verified LINE binding. Runtime connects through an unprivileged login and executes each read with `SET LOCAL ROLE zuri_line_smartgift_ro`. | Binding reserved remotely as PENDING; live role isolation passes, activation destination/canary gates remain |
| FR-053 | Phase 1 golden question evaluation: validate a versioned corpus of at least 20 approved business questions against registered queries, bounded evidence, policy outcomes and allowed numeric claims. The evaluator supports injected fake ports and an environment-only real-provider mode, emits redacted evidence, and requires 20/20 with zero unsupported numbers. | Implemented (beta): deterministic fake evaluation PASS 20/20; owner-approved real corpus mapping and real-provider execution remain external NOT_RUN gates |
| FR-054 | Controlled LINE canary readiness: produce a secret-safe runtime-role isolation report and dry-run canary plan that validates exact project/Tenant/Business/binding/provider/evaluation prerequisites. Readiness code never activates a binding or calls LINE; receipt states distinguish accepted from display/read unknown. | Implemented (beta): secret-redacted live probe passes exact 74-row scope; approved provider evaluation and signed LINE canary remain external NOT_RUN gates |
| FR-055 | Controlled LINE activation and receipt: a dry-run-default operator command may install HMAC hashes and activate exactly one expiring binding only through a versioned compare-and-swap transaction and dedicated least-privilege role. Routing-first rollback and append-only redacted receipt events preserve truthful `ACCEPTED_BY_LINE` versus display/read unknown semantics. | Owner-approved for local implementation; production mutation remains gated |
| FR-056 | Zuri-branded entry landing: `/` presents a full-viewport, responsive Zuri Heritage composition with one route-bearing action to `/login`, code-native/local visuals, reduced-motion support, and no third-party fashion or commerce semantics. FR-044/046 routing and identity boundaries remain unchanged. | Owner-approved beta 2026-08-14 |
| FR-057 | Authorized agent context: every LINE turn resolves ExternalIdentity, Person, Membership, thread/session assurance and server-owned agent/workspace/project scope, then calls GoVibe/MSP API-010 `msp_vault_resolve` before API-009 retrieval; the model, prompt, client payload and stale session cannot widen the canonical authorized vault set. | Owner-approved beta; API-010 integration in progress |

> **ADR-013 clarification (2026-08-13):** FR-032's historical Group-entry wording is
> superseded for the operational shell. Home may show Organization/Portfolio ancestry
> while choosing a Business, but it never enters a Group Overview; `/overview` requires
> a selected Business. Portfolio progress remains a reporting API.

## 1.4 Non-functional requirements

| ID | Requirement | หลักฐาน |
|---|---|---|
| NFR-001 | Runtime offline สมบูรณ์หลัง `npm install` (SQLite, ไม่มี cloud/CDN/font ภายนอก) | FINAL.md matrix |
| NFR-002 | `npm run build` ผ่านโดยไม่มี error | build clean; 32 API routes + 24 pages |
| NFR-003 | Responsive ถึง 375px โดยไม่มี horizontal scroll | e2e test |
| NFR-004 | Keyboard: palette เต็มรูปแบบ, aria labels, progressbar roles | e2e + code |
| NFR-005 | Progress calculators deterministic (pure, no clock/random) | 31 unit tests |
| NFR-006 | Persistence ย้ายไป Postgres ได้โดยไม่แก้ semantics (string enums, UUID, JSON strings) | DB-MIGRATION-NOTES.md |
| NFR-007 | Seed idempotent / reset ได้ (`db:seed`, `db:reset`) | verified double-run |
| NFR-008 | UI ที่เพิ่มหรือแก้ใน V2 ใช้ semantic/component token, มี state contract และผ่าน WCAG 2.2 AA baseline; V1 module ที่ lift ยังคง parity boundary จนกว่าจะ cutover | ADR-010 + design-system test + visual route check |
| NFR-009 | Local file operations are crash-recoverable and portable: authoritative metadata survives restart/remount, cache is fully rebuildable, absolute device paths never become identity, and canonical results are available when cache is stale or absent. | FR-045 unit/integration/remount/cache parity gates |

| NFR-010 | LINE business answers fail closed within a bounded request deadline: network calls use explicit timeouts/cancellation, duplicate delivery is idempotent, provider failure cannot expose secrets or raw data, and offline/local evaluation remains possible through an injected adapter. | FR-047..050 contract, timeout and redelivery tests |
| NFR-011 | Production tenancy changes are migration-first, idempotent and reversible: advisory/lock timeouts bound deployment, reserved code/UUID collisions abort, schema history and backups are inspected before apply, and no runtime secret or service-role key is stored in source, migration SQL, logs or browser code. | Production migration/import/isolation evidence captured; activation gates pending |
| NFR-012 | Activation evidence is deterministic, versioned and redacted: credentials come only from process environment/approved secret stores; reports contain hashes and assertion results rather than raw authorization material, database URLs, reply tokens or PII. | FR-053/054 contract and secret-scan gates |
| NFR-013 | Binding activation and rollback are atomic, idempotent and bounded: exact row/version/evidence hashes are locked and compared, one correlation ID produces at most one state change, activation expires, and rollback disables routing before any secondary remediation. | FR-055 / ADR-020 |
| NFR-014 | Authorization decisions are recomputed per turn and remain bounded, auditable and fail-closed across restart, horizontal instances, identity revocation and Membership revocation. | FR-057 / ADR-022 contract and security tests |

## 1.5 Business rules

| ID | Rule |
|---|---|
| BR-001 | `tenant_id` = ขอบเขต isolation และการแชร์ข้อมูล — branch ไม่มีวันเป็น tenant; ธุรกิจใน tenant เดียวกันแชร์ CRM ได้, ต่าง tenant แชร์ไม่ได้ |
| BR-002 | External ID (tax id, GitHub id, LINE id, SAP id) ไม่มีวันเป็น primary key — UUID ภายใน + human code + ExternalRef |
| BR-003 | ไม่มี template picker — โปรเจกต์เริ่มจากเป้าหมาย, execution mode เป็นของ workstream |
| BR-004 | Execution mode มีเพียง 7 โหมด canonical ห้ามเพิ่มใน v1 |
| BR-005 | ห้ามใช้ tasks_done/tasks_total เป็น progress สากล — ต้อง strategy-based + weighted roll-up |
| BR-006 | Required gate ที่ยังไม่ผ่าน cap progress ที่ 99% พร้อม warning |
| BR-007 | แผนที่ import เป็นข้อมูลเท่านั้น — ไม่มีการ execute code จาก plan |
| BR-008 | Restore snapshot ต้อง preview + confirm เสมอ — ไม่มี silent overwrite |
| BR-009 | ทุก intake surface (UI/Excel/agent/API) ต้องจบที่ pipeline validate→dry-run→commit เดียวกัน |
| BR-010 | SQLite is the sole transactional authority for file identity and relations. Filesystem content and `.zuri/cache` are projections/storage, never a second writable relationship database; Business aggregation must query IDs/links and never duplicate a file merely to show it in another view. |

| BR-011 | A LINE event has exactly one reply owner. When stack answering is enabled, `zuri-cli` owns signature verification and Reply API transport while `zuri-ai` owns knowledge/provider/answer policy; the legacy local answer path must not also consume the same `replyToken`. |
| BR-012 | Tenant and Business scope are server authority. In production a caller may present only binding identity, destination and binding-scoped credential; inbound `tenantId`/`businessId` never authorize access. A missing, mismatched, inactive, expired or database-unavailable binding fails closed before model or persistence work. |
| BR-013 | Readiness is not activation. Golden evaluation, database probes and canary planning may run while the binding remains `PENDING`; only a separately approved operator action may install hashes or enable one canary. `ACCEPTED_BY_LINE` never proves display or read. |
| BR-014 | An activation correlation owns at most one binding mutation and one LINE canary. Replays return the existing redacted result or fail closed; they never create a second send. |
| BR-015 | LINE transport authentication proves event origin only. Principal, tenant, business, thread audience, capability, sensitivity and vault access come from server-owned identity and policy; thread membership may attenuate access but never elevate it. |

## 1.6 Acceptance criteria

AC ทั้งชุดอยู่ที่ `../../docs/ACCEPTANCE-CRITERIA.md`; ผลการตรวจรายข้อ (ทุกข้อ PASS)
อยู่ที่ `../.agent/reports/FINAL.md` — traceability ราย FR ดู Appendix D

FR-040 acceptance criteria and its implementation exit gates are defined in
[`features/FR-040-project-work-views.md`](features/FR-040-project-work-views.md)
and [`roadmap/PLAN-FR-040-PROJECT-WORK-VIEWS.md`](roadmap/PLAN-FR-040-PROJECT-WORK-VIEWS.md).

---

# Layer 2 — Software Design (SDD)

## 2.1 Architecture

```text
Next.js App Router (src/app: UI (pm) group + API handlers)
  → Application services (src/modules/project-manager/application)
  → Pure domain (progress/strategies, rollup, import/plan-schema)
  → Prisma singleton (src/lib/db.js) → SQLite
```

รายละเอียด: `ARCHITECTURE-NOTES.md`

## 2.2 Design decisions

| ID | Decision | เหตุผล |
|---|---|---|
| SDD-001 | ~~Standalone repo ก่อน integrate (ADR-001)~~ **superseded by ADR-003** — V2 แทน V1 ด้วยการ reuse (ยก UI ทีละโมดูลตอน cutover) | เหตุผลเดิม (กัน regression, ทดลอง schema อิสระ) ทำหน้าที่จบแล้ว |
| SDD-002 | Persisted enums เป็น string, Zod (`src/lib/validation/enums.js`) เป็น source of truth เดียว | Postgres migration ไร้ connector coupling |
| SDD-003 | UUID PK + human code (unique) พร้อม collision retry | BR-002; code ใช้อ้างใน Excel/envelope ได้ |
| SDD-004 | Soft delete (`deletedAt`) + `version` counter บน aggregate roots | audit-friendly, กู้คืนได้ |
| SDD-005 | Progress calculators เป็น pure function; `progressCache` เป็น advisory เท่านั้น | deterministic tests, คำนวณซ้ำได้เสมอ |
| SDD-006 | Import commit ใน `prisma.$transaction` เดียว, upsert by code | atomicity + idempotent re-import |
| SDD-007 | UI เป็น client fetch (`useFetch`) เรียก API handlers ซึ่ง delegate ให้ services | MVP-simple; server-component read path เป็นงานอนาคต |
| SDD-008 | JavaScript + Zod ที่ boundary (ไม่ใช่ TypeScript) — **ยึดกับไฟล์ใดไฟล์หนึ่งไม่ได้โดยธรรมชาติ** | mandate จาก MASTER-PROMPT tree · ความเสี่ยงที่ตามมา: ไม่มี compiler บังคับสัญญา จึงต้องมี contract test ก่อนเขียนไส้ endpoint ใหม่ (ADR-003 §D6) |
| SDD-009 | Unified intake: ทุก surface แปลงเป็น envelope เดียว | BR-009; เทสต์ pipeline ชุดเดียวคุ้มทุกทาง |
| SDD-010 | Zuri Heritage UI ใช้ CSS token 3 ชั้น (primitive → semantic → component); legacy aliases ช่วย migrate, shared V2 primitives มาก่อน, V1 lift เปลี่ยนเฉพาะ cutover ที่ parity-tested | ADR-010; NFR-008; ลด global restyle risk |
| SDD-011 | Home derives its cards from the viewer gate plus the already-loaded scope inventory. The viewer decides visibility; the client never infers authorization from the full scope list. A group selection persists Portfolio scope, a business selection persists Portfolio + Business scope, then Home navigates to Overview. | FR-031, FR-032; ADR-008 |
| SDD-012 | Topbar is navigation chrome, not a scope-editor. Removing its selectors avoids a second scope-control surface; its remaining controls do not alter the ambient Portfolio/Business/Workspace/Project selection. | FR-033; ADR-008, SITEMAP-V2 §5 |
| SDD-013 | Breadcrumb scope links are deterministic page routes, not menus: Home owns Group/Business, Workspaces owns Workspace, and Projects owns Project. The current lens provides display labels only; it never changes the underlying scope identity. | FR-034; SITEMAP-V2 §2b |
| SDD-014 | Overview is Business-first. A selected Business renders only its scoped project aggregates and links to active V2 domain entry points; an unselected Business renders a Home-required state. Portfolio progress remains a reporting API, not an operational landing. | FR-035; ADR-013 |
| SDD-015 | Project Team reuses Membership rather than inventing a ProjectMember model. For a business workspace, mutation is limited to memberships whose `businessId` equals the project workspace; tenant-wide memberships are visible but immutable in this view. Assignee load counts non-deleted WorkItems in the project where `assigneeRef` equals the member’s person id. | FR-036; BR-001, SEC-003 |
| SDD-016 | `ProjectFile` is an additive SQLite schema change with an equivalent generated Postgres schema. It stores only file metadata plus a local/remote reference (`url` or `blobRef`); a service confirms an optional WorkItem belongs to the Project before persisting. The repo has no Prisma migration baseline, so the additive SQL is recorded as an artifact while the established `db:push` workflow applies local schema. | FR-037; BR-002, SEC-003 |
| SDD-017 | `Membership.domainKeysJson` persists an allow-list of DOMAINS keys for MEMBER. Empty is deny-by-default. Owner and DEV derive all current domains from their role, not from checkbox state. The resolver is the only interpreter; DomainBar reads its `visibleDomains`, and owner-only API mutations audit the resulting role/domain grant. | FR-038; FR-031, SEC-003 |
| SDD-018 | `ScopeContext` keeps the existing identity fields but exposes only Portfolio, Tenant, and Business to shell context. `scope-views` supplies their ERP/PM vocabulary. Domain configuration renders the existing `projects` key as Development; schema Workspace/Project stay module-local and never drive shell navigation. | FR-039; ADR-011, BR-001 |
| SDD-019 | `ProjectTabs` is the project-local boundary. Its `Work` tab owns `Structure Plan`, `Board`, `Schedule`, and `Dependency Map`. The map is a read model built from existing Dependency records and project-owned endpoints only; it never becomes a Development sidebar item, a shell scope, or a new persisted aggregate. | FR-040; ADR-012, FR-005, FR-007, NFR-008 |
| SDD-020 | Business Strategy is a read model over `BusinessRoadmap`, `BusinessRoadmapHorizon`, `BusinessGoal`, and `ProjectGoal`. The service returns two or three ordered horizons and filters by the selected Business; no Project or Organization is promoted to shell scope. | FR-041; ADR-013, BR-001 |
| SDD-021 | Project ownership is direct through nullable `businessId`; `workspaceId` is a Development Space context. Services derive and validate the owner against the Space, allow null only for explicit portfolio/tenant shared work, and render Business before Space in Project context. | FR-043; ADR-014, BR-001, SEC-001 |
| SDD-022 | Route groups enforce the interface boundary: EntryShell owns `/` and `/login`, BusinessRoutingShell owns `/businesses`, BusinessShell owns `/overview` and Business-bound domains, and ProjectResourceShell remains nested below BusinessShell. Missing viewer/business context redirects before shell render. Existing Zuri tokens are reused; token redesign is deferred. | FR-044; ADR-015, SDD-011, SDD-014 |
| SDD-023 | `FileAsset` + validated `FileLink` form the portable file metadata graph; `LocalWorkspaceMount` maps one device-local absolute root to stable relative paths. Managed ingest is staged and audited, missing files require explicit reconcile/relink, cache entries carry source revision and are disposable, and the legacy ProjectFile API remains behind a migration adapter until ZV2-CR-001 parity/rollback gates pass. | FR-045; ADR-016, BR-010, NFR-009, SEC-007 |
| SDD-024 | A provider-neutral `SessionPort` resolves trusted request identity before `resolveViewer()`. `GET /api/entry` queries outward only from viewer-visible Business IDs and returns minimal Business plus Portfolio/Tenant ancestry in one response. `/businesses` stops consuming broad `/api/scope`; `/api/viewer` remains compatibility-only and uses the same trusted seam. | Implemented beta; FR-046, ADR-017, SEC-008, ZV2-CR-002 |

| SDD-025 | The Phase 1 LINE pilot is a ports-and-adapters vertical slice. `BusinessKnowledgeReadPort` owns registered bounded reads, `ModelProviderPort` owns normalized generation, and the grounded-answer service verifies evidence before returning reply text. `zuri-cli` remains the only LINE signature/reply transport. Supabase is operational relational storage; GenesisBlockDB/MSP/GKS are not Phase 1 dependencies. | FR-047..050; ADR-007 amendment; ZV2-CR-003 |
| SDD-026 | Supabase production authority uses a private `zuri_core` schema with stable internal UUIDs, composite Tenant/Business foreign keys and forced RLS. A `NOLOGIN` scope role owns the policies; a separate unprivileged login has no direct grants and every query uses a short transaction plus `SET LOCAL ROLE`. Curated DuckDB data is imported through a reconciled, hash-bound transaction and does not make GenesisBlockDB a Supabase replacement. | FR-051..052; ADR-018; ZV2-CR-004 |
| SDD-027 | Phase 1 activation uses three independent evidence ports: a deterministic GoldenEvaluation runner over injected knowledge/provider ports, a transaction-scoped RuntimeIsolationProbe, and a mutation-free CanaryPreflight. W4 combines their redacted artifacts; no readiness component owns secret persistence, binding mutation or LINE transport. | FR-053..054; ADR-019; ZV2-CR-005 |
| SDD-028 | FR-055 adds a separate operator port: strict schemas feed a dry-run-default CLI, a dedicated database role performs one versioned CAS mutation plus append-only event, and a `zuri-cli` adapter imports only redacted hash-pinned transport evidence. Readiness, mutation and transport remain separate owners. | FR-055; ADR-020 / ZV2-CR-006 |
| SDD-029 | EntryShell exposes a landing-only full-viewport variant while keeping Login compact. The landing presentation owns its inert operational signal field, applies pointer motion only on fine-pointer non-reduced-motion devices, and keeps exactly one `/login` link. Metadata and raster assets are Zuri-owned and local. | FR-056; ADR-021, ADR-010, ADR-015 |
| SDD-030 | Agent turns construct an immutable AuthContext and resolve an explicit authorized vault set before MSP retrieval. Private memory ownership is Tenant × Principal × Agent × Workspace; thread/session/instance/event are provenance and lifecycle. Legacy principal-only keys remain explicit compatibility mode only. | FR-057; ADR-022; BR-015; SEC-013 |

## 2.3 Security requirements

| ID | Requirement | สถานะ |
|---|---|---|
| SEC-001 | Cross-tenant/business guard (`assertWorkspaceInScope`) — ปฏิเสธข้าม scope | ✅ tested |
| SEC-002 | ไม่ execute code จาก imported plans (strict Zod, additionalProperties rejected) | ✅ tested |
| SEC-003 | AuditEvent append-only สำหรับทุก mutation สำคัญ | ✅ |
| SEC-004 | MVP ไม่มี customer PII ในระบบ | ✅ by scope **— เป็นจริงเฉพาะวันนี้**: ADR-003 พา LINE เข้ามาเป็น surface หลัก ข้อความลูกค้าคือ PII ต้องรื้อข้อนี้ก่อนงาน LINE เริ่ม (`TASK-V2-LINE-INTENT`) |
| SEC-005 | PDPA: consent ต่อธุรกิจใน `CustomerBusinessProfile` เมื่อทำ CRM sharing | 🔜 **เลื่อนขึ้นเป็น P0 ของ PHASE-V2-REPLACE** — ไม่ใช่ "เฟส CRM ทีหลัง" อีกแล้ว เพราะ LINE-first แปลว่าข้อมูลลูกค้าเข้าระบบตั้งแต่วันแรก |
| SEC-006 | Enterprise API ต้องมี token auth ต่อ tenant ก่อนเปิดใช้จริง | 🔜 |
| SEC-007 | Every local file operation must authorize Tenant/Business/Project scope and enforce mounted-root containment, rejecting absolute/traversal and symlink/junction/reparse escape. OS reveal is local-capability-only; hosted requests can never launch a server process. | ✅ tested; ADR-016 / FR-045 security gates |
| SEC-008 | Pre-shell identity and authorization fail closed: principal, role, platform grant, visible Business IDs and domains come only from a trusted server session plus persisted authority. Missing/invalid sessions return 401 before scope queries; adapter failure returns 503; production can never activate the seeded-owner demo fallback. | Implemented beta; ADR-017 / FR-046 security gate |

| SEC-009 | Public LINE knowledge access is server-only and deny-by-default: server-owned tenant/business binding, no public service-role key, explicit Supabase grants plus RLS for exposed tables, allow-listed fields/queries, prompt-data treated as untrusted, and secrets/PII/cost/margin/invoice data excluded from prompts, logs and responses. | Phase 1 security gate; FR-047..050 / ZV2-CR-003 |
| SEC-010 | Production LINE reads require both database-enforced scope and verified server binding: private-schema base grants are revoked from `public`, `anon`, `authenticated` and `service_role`; the runtime rejects privileged credentials and client-selected scope; credential/destination hashes are compared in constant time; inactive or expired bindings return no data. | Remote policy/grant proof complete; live runtime-login and LINE canary pending / ADR-018 |
| SEC-011 | Activation tooling fails closed and never persists or echoes credentials, full connection URLs, authorization headers, reply tokens or raw customer data. Database mutation assertions always roll back; canary readiness defaults to dry-run and has no binding-update or LINE-send capability. | FR-053/054 security gate; ADR-019 |
| SEC-012 | Activation secrets are environment/secret-store only; a dedicated operator role can update only the exact binding and append events. Runtime/Data API/service roles cannot activate. Receipt ingestion rejects raw destination, authorization, reply token, message content and PII. | FR-055 security gate; ADR-020 |
| SEC-013 | Private MSP retrieval is deny-by-default and policy-before-retrieval: no client/model/prompt/thread label can select a vault; identity or Membership revocation denies the next turn; Supabase/RLS remains defense in depth and user-editable metadata is not authorization input. | FR-057 / ADR-022 security gate |

## 2.4 API / DB / Testing / Deployment

- API surface: Appendix A · DB schema: Appendix B (`prisma/schema.prisma` 19 models)
- Testing: 129 Vitest (unit+integration, isolated `prisma/test.db`) + 28 Playwright E2E — รายละเอียด `../../docs/TEST-PLAN.md` + PHASE-07 report
- Deployment: local เท่านั้นใน MVP; เส้นทาง Postgres/v2 ดู `DB-MIGRATION-NOTES.md` + `ZURI-INTEGRATION-ASSESSMENT.md`

---

# Layer 3 — AI System

## 3.1 Agent boundary

| ID | Spec |
|---|---|
| AI-AGT-001 | Planning Agent อยู่**นอก**แอป — contract เดียวคือ `contracts/plan-envelope.schema.json` (schemaVersion 1.0); แอปทำงานได้สมบูรณ์โดยไม่มี LLM |
| AI-AGT-002 | การ import จาก agent ติด `actorType: AGENT_PLAN` ใน audit; จาก UI = `LOCAL_USER` — แยกได้เสมอว่าใครเขียนอะไร |
| AI-AGT-003 | Enterprise headless surface (ExternalRef + OpenAPI gen จาก Zod) — `ENTERPRISE-API-SURFACE.md` | 
| AI-ETH-001 | ห้าม execute เนื้อหาใด ๆ จาก plan; unknown mode/strategy ถูกปฏิเสธที่ schema; ทุก commit มี dry-run + audit trail ตรวจย้อนได้ |

ไม่มี model lifecycle/model cards ใน repo นี้ (ไม่มีการ train/host โมเดล) — จะเพิ่ม
เมื่อ Zuri.Ai ฝัง agent จริงในเฟสถัดไป
