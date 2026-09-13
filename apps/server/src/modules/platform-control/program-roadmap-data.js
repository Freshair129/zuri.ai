// @req FR-105 — one immutable projection of the submitted 24-week programme.
// @spec ADR-048 D3 — plan snapshot only; never a Git-derived completion claim.
// @tested tests/unit/platform-control-route-contract.test.js

// Re-projected 2026-09-13 from the source document's own frontmatter and
// tables (v0.3.0 → v0.4.0, CR-019): the metadata below states what the
// DOCUMENT says about itself, never what today's git happens to be —
// refreshing baselineCommit to "current HEAD" would falsify the plan's
// provenance. The document's baseline moved because the document was
// re-baselined, not because HEAD moved.
export const PROGRAMME_SNAPSHOT = {
  documentId: 'ROADMAP-ZURI-AI-24W-PROGRAM',
  status: 'approved',
  version: '0.4.1',
  updated: '2026-09-13',
  baselineCommit: '2b7ad27d',
  programmeStart: '2026-08-24',
  programmeEnd: '2027-02-07',
  sourceLabel: 'Submitted 24-week programme · CR-019',
}

// Repository history, sections 5.3 and 5.3.1 of the document — copied from the
// document, not measured by this page. It is history of the repository, never
// programme completion (ADR-048 D3): the board labels it as such. Rows are
// [day, date, commits, +lines, -lines, cumulativeAdjusted, frDeclared, frMark, testFiles].
// D1–D13: frMark is FEATURE-MAP "live"; D13+ onward it is PRD "✅" (stricter, 62 vs 82 at
// the baseline — the document says not to compare the two across the join).
// cumulativeAdjusted excludes the D27 monorepo relocation commit (a5138eec, +209,170).
export const PROGRAMME_HISTORY = {
  measuredAt: '9b8a4fc9',
  measuredOn: '2026-09-13',
  baselineDay: 'D13',
  note: 'Repository history from the submitted document (sections 5.3, 5.3.1). Not plan progress.',
  rows: [
    ['D1', '2026-08-11', 3, 18260, 15, 18245, null, null, 9],
    ['D2', '2026-08-12', 36, 62215, 2833, 77627, 30, 30, 31],
    ['D3', '2026-08-13', 12, 18170, 4845, 90952, 44, 44, 64],
    ['D4', '2026-08-14', 30, 40759, 6205, 125506, 55, 55, 106],
    ['D5', '2026-08-15', 12, 11134, 8985, 127655, 57, 57, 113],
    ['D6', '2026-08-16', 39, 16842, 46234, 98263, 59, 59, 124],
    ['D7', '2026-08-17', 56, 22120, 1493, 118890, 71, 65, 143],
    ['D8', '2026-08-18', 57, 48849, 3984, 163755, 81, 75, 194],
    ['D9', '2026-08-19', 21, 20374, 1628, 182501, 89, 78, 224],
    ['D10', '2026-08-20', 86, 18472, 2192, 198781, 93, 81, 246],
    ['D11', '2026-08-21', 31, 13069, 1869, 209981, 93, 82, 262],
    ['D12', '2026-08-22', 7, 2392, 1385, 210988, 93, 82, 263],
    ['D13', '2026-08-23', 2, 281, 52, 211217, 93, 82, 263],
    ['D13+', '2026-08-23', 12, 8300, 289, 219228, 98, 62, 270],
    ['D14', '2026-08-24', 6, 5463, 599, 224092, 101, 62, 276],
    ['D15', '2026-08-25', 2, 153, 17, 224228, 102, 62, 280],
    ['D16', '2026-08-26', 20, 13258, 2687, 234799, 105, 71, 293],
    ['D17', '2026-08-27', 41, 18815, 1457, 252157, 112, 80, 308],
    ['D18', '2026-08-28', 65, 7513, 1106, 258564, 117, 87, 321],
    ['D19', '2026-08-29', 48, 9713, 1008, 267269, 118, 88, 324],
    ['D20', '2026-08-30', 53, 21116, 1287, 287098, 128, 93, 344],
    ['D21', '2026-08-31', 16, 5608, 587, 292119, 132, 93, 357],
    ['D22', '2026-09-01', 4, 4226, 129, 296216, 132, 93, 362],
    ['D23', '2026-09-02', 43, 34393, 2838, 327771, 141, 92, 398],
    ['D24', '2026-09-03', 34, 5983, 1081, 332673, 141, 91, 415],
    ['D25', '2026-09-04', 39, 10609, 1597, 341685, 145, 93, 429],
    ['D26', '2026-09-05', 20, 5908, 629, 346964, 146, 92, 432],
    ['D27', '2026-09-06', 172, 316261, 14299, 444524, 147, 92, 438],
    ['D28', '2026-09-07', 194, 37159, 6881, 474802, 161, 92, 583],
    ['D29', '2026-09-08', 53, 39026, 2928, 510900, 170, 92, 610],
    ['D30', '2026-09-09', 17, 14010, 1774, 523136, 173, 91, 648],
    ['D31', '2026-09-10', 43, 17264, 884, 539516, 173, 91, 656],
    ['D32', '2026-09-11', 98, 51582, 6823, 584275, 189, 91, 697],
    ['D33', '2026-09-12', 65, 38504, 4680, 618099, 190, 91, 708],
    ['D34', '2026-09-13', 17, 3405, 475, 621029, 200, 100, 729],
  ],
}

export const PROGRAMME_DELIVERABLES = [
  'Visual Office 2.5D',
  'GoVibe Mission Control — the Development-domain Project system, plus the agent mission feed',
  'Interactive Node View 3D',
  'Second Brain / governed memory',
  'Five core agent roles',
  'Two cross-integrated Businesses',
  'Up to five automation workflows',
  'Up to three standard connectors',
  'L1–L4 approval, verification and notification',
  'Deployment, UAT, training and handover',
  'ERP business modules (CR-019)',
]

export const PROGRAMME_GATES = [
  ['GATE-ZAI-01', 'Visual Office presents Business, Agent, Mission and Approval', 'unmet'],
  ['GATE-ZAI-02', 'Node View renders and searches agreed graph relationships', 'unmet'],
  ['GATE-ZAI-03', 'Second Brain retrieval respects Business, Role and Permission', 'unmet'],
  ['GATE-ZAI-04', 'Two Businesses remain isolated under policy', 'unmet'],
  ['GATE-ZAI-05', 'Five roles execute their specified workflows', 'unmet'],
  ['GATE-ZAI-06', 'Automation, retry, verification and approval pass UAT', 'unmet'],
  ['GATE-ZAI-07', 'Connectors refuse out-of-scope reads', 'unmet'],
  ['GATE-ZAI-08', 'Deployment, documentation and training handover is accepted', 'unmet'],
  ['GATE-ZAI-09', 'ERP modules run on production for Business one with every migration applied and only declared agent tools', 'unmet'],
]

export const PROGRAMME_PHASES = [
  { id: 'PHASE-ZAI-01', weeks: 'W1–4', dates: '24 Aug – 20 Sep 2026', status: 'in-progress', progress: 90, goal: 'Consolidate the inherited foundation into a production-grade base; land the ERP business modules for Business one', sprints: [
    { id: 'SPR-ZAI-01', weeks: 'W1–2', dates: '24 Aug – 6 Sep', status: 'in-progress', progress: 93, goal: 'Close identity, session and authorization to production standard; Inventory, Sales, Commerce, Procurement, Assets and LINE OA Studio lanes land' },
    { id: 'SPR-ZAI-02', weeks: 'W3–4', dates: '7 – 20 Sep', status: 'in-progress', progress: 87, goal: 'Settle tenancy, pipeline monitor and memory contract; seventeen-stage knowledge intake and Tier 1 accounted as built; SmartGift SCM, Marketing, billing/POS, catalog convergence and identity lifecycle land' },
  ] },
  { id: 'PHASE-ZAI-02', weeks: 'W5–8', dates: '21 Sep – 18 Oct 2026', status: 'planned', progress: 0, goal: 'Stand up the agent workforce and the governance ladder; knowledge base and file system for the seventeen-stage pipeline on production; activate deliverable 11 on production', sprints: [
    { id: 'SPR-ZAI-03', weeks: 'W5–6', dates: '21 Sep – 4 Oct', status: 'planned', progress: 0, goal: 'Build the agent role registry and five core roles; knowledge base console, binary parsing, durable file storage and the production seventeen-stage runtime; apply every pending ERP migration' },
    { id: 'SPR-ZAI-04', weeks: 'W7–8', dates: '5 – 18 Oct', status: 'planned', progress: 0, goal: 'Add approvals, verification, notification and Mission Control binding' },
  ] },
  { id: 'PHASE-ZAI-03', weeks: 'W9–12', dates: '19 Oct – 15 Nov 2026', status: 'planned', progress: 0, goal: 'Second Business, governed analytics, workflows and connectors; deliverable 11 accepted', sprints: [
    { id: 'SPR-ZAI-05', weeks: 'W9–10', dates: '19 Oct – 1 Nov', status: 'planned', progress: 0, goal: 'Business template, onboarding and isolation proof' },
    { id: 'SPR-ZAI-06', weeks: 'W11–12', dates: '2 – 15 Nov', status: 'planned', progress: 0, goal: 'Analytics, connector two, workflows one/two and the GATE-ZAI-09 evidence run' },
  ] },
  { id: 'PHASE-ZAI-04', weeks: 'W13–16', dates: '16 Nov – 13 Dec 2026', status: 'planned', progress: 0, goal: 'Visual Office 2.5D and agent activity experience', sprints: [
    { id: 'SPR-ZAI-07', weeks: 'W13–14', dates: '16 – 29 Nov', status: 'planned', progress: 0, goal: 'Scene model, live reads and accessibility contract' },
    { id: 'SPR-ZAI-08', weeks: 'W15–16', dates: '30 Nov – 13 Dec', status: 'planned', progress: 0, goal: 'Agent presence and approval queue in scene' },
  ] },
  { id: 'PHASE-ZAI-05', weeks: 'W17–20', dates: '14 Dec 2026 – 10 Jan 2027', status: 'in-progress', progress: 20, goal: 'Second Brain, Node View 3D and remaining automation', sprints: [
    { id: 'SPR-ZAI-09', weeks: 'W17–18', dates: '14 – 27 Dec', status: 'in-progress', progress: 50, goal: 'Permissioned retrieval and replay lineage — started early on the deliverable-4 substrate' },
    { id: 'SPR-ZAI-10', weeks: 'W19–20', dates: '28 Dec – 10 Jan', status: 'planned', progress: 0, goal: '3D node view, handoff contracts, workflows and connector three' },
  ] },
  { id: 'PHASE-ZAI-06', weeks: 'W21–24', dates: '11 Jan – 7 Feb 2027', status: 'planned', progress: 0, goal: 'Harden, prove, deploy and hand over', sprints: [
    { id: 'SPR-ZAI-11', weeks: 'W21–22', dates: '11 – 24 Jan', status: 'planned', progress: 0, goal: 'Integration hardening plus load and security campaign' },
    { id: 'SPR-ZAI-12', weeks: 'W23–24', dates: '25 Jan – 7 Feb', status: 'planned', progress: 0, goal: 'UAT, deployment, training and handover' },
  ] },
]

export const PROGRAMME_TASKS = [
  ['TASK-ZAI-001', 'SPR-ZAI-01', 'Close the production request-session and credential boundary', 'NFR', 'C-3', 'H3', 'review'],
  ['TASK-ZAI-002', 'SPR-ZAI-01', 'Declare the five built-but-undeclared features into the registry', 'NFR', 'C-1', 'H1', 'done'],
  ['TASK-ZAI-003', 'SPR-ZAI-01', 'Profile-first onboarding and Waiting Room, FR-066', 'FR', 'C-2', 'H2', 'done'],
  ['TASK-ZAI-004', 'SPR-ZAI-02', 'Workspace collaboration boundary and scoped invites, FR-067', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-005', 'SPR-ZAI-02', 'Supabase data pipeline monitor and replay, FR-071', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-006', 'SPR-ZAI-02', 'Write the governed memory read and write contract', 'NFR', 'C-3', 'H3', 'review'],
  ['TASK-ZAI-007', 'SPR-ZAI-03', 'Agent Role registry with five core roles', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-008', 'SPR-ZAI-03', 'Role-scoped memory partition and retrieval policy', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-009', 'SPR-ZAI-03', 'Agent Factory, the standard business agent template', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-010', 'SPR-ZAI-04', 'Approval Gateway L1 to L4 over the FR-026 action gate', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-011', 'SPR-ZAI-04', 'Verification and notification fabric on approval outcomes', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-012', 'SPR-ZAI-04', 'Mission feed: agent missions and their approvals surface as Development-domain work in the Project system', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-013', 'SPR-ZAI-05', 'Standard Business Template and provisioning path', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-014', 'SPR-ZAI-05', 'Onboard Business number two end to end under isolation', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-015', 'SPR-ZAI-05', 'Per-business visibility regression at two-business scale', 'NFR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-016', 'SPR-ZAI-06', 'Cross-business governed analytics read model', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-017', 'SPR-ZAI-06', 'Connector number two under the FR-081 ingestion boundary — FlowAccount read-only pull, FR-125', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-018', 'SPR-ZAI-06', 'Automation workflows one and two end to end', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-019', 'SPR-ZAI-07', 'Visual Office 2.5D scene model and shell', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-020', 'SPR-ZAI-07', 'Bind Business, Agent, Mission and Approval objects to live reads', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-021', 'SPR-ZAI-07', 'Accessibility and reduced-motion contract for the 2.5D surface', 'NFR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-022', 'SPR-ZAI-08', 'Live agent activity presence and mission tracking in-scene', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-023', 'SPR-ZAI-08', 'Surface the L1 to L4 approval queue inside Visual Office', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-024', 'SPR-ZAI-09', 'Second Brain retrieval by Business, Role and Permission', 'FR', 'C-3', 'H3', 'in-progress'],
  ['TASK-ZAI-025', 'SPR-ZAI-09', 'Memory lineage, replay and the no-silent-replay guarantee', 'NFR', 'C-3', 'H3', 'in-progress'],
  ['TASK-ZAI-026', 'SPR-ZAI-10', 'Interactive Node View 3D over the governed relation graph', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-027', 'SPR-ZAI-10', 'Structure and edge direct manipulation with handoff contracts', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-028', 'SPR-ZAI-10', 'Automation workflows three to five and connector number three', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-029', 'SPR-ZAI-11', 'Integration hardening plus load and security test campaign', 'NFR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-030', 'SPR-ZAI-12', 'UAT, deployment, data and security checklist, training and handover', 'NFR', 'C-3', 'H4', 'planned'],
  ['TASK-ZAI-031', 'SPR-ZAI-01', 'Inventory catalogue, stock ledger, recipes and product natures — FEAT-020, FR-154 to FR-156, FR-168', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-032', 'SPR-ZAI-01', 'Sales tasks in CRM — FEAT-022, FR-161', 'FR', 'C-2', 'H2', 'done'],
  ['TASK-ZAI-033', 'SPR-ZAI-01', 'Commerce orders and payments — FEAT-023, FR-166, FR-163', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-034', 'SPR-ZAI-01', 'Procurement suppliers, purchase orders and goods receipts — FEAT-024, FR-164, FR-165', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-035', 'SPR-ZAI-01', 'Asset Management foundation, evidence intake and edge extraction — FEAT-015 to FEAT-017, FR-133 to FR-144', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-036', 'SPR-ZAI-01', 'LINE OA Studio multi-account, rich menu, LIFF and server-owned transport — FEAT-018, FEAT-019, FR-146 to FR-153, FR-190', 'FR', 'C-3', 'H3', 'in-progress'],
  ['TASK-ZAI-037', 'SPR-ZAI-02', 'SCM and CRM parent navigation, Business capabilities and module tabs — FR-167, FR-169, FR-170, FR-172', 'FR', 'C-2', 'H2', 'done'],
  ['TASK-ZAI-038', 'SPR-ZAI-02', 'SmartGift SCM located ledger, landed cost, work orders, ATP and agent tools — FEAT-025, FR-174 to FR-182', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-039', 'SPR-ZAI-02', 'Commerce billing documents, POS checkout and physical stocktake — FR-186, FR-183, FR-184', 'FR', 'C-3', 'H3', 'review'],
  ['TASK-ZAI-040', 'SPR-ZAI-02', 'Marketing strategy, campaigns, content, operations and broadcast planning — FEAT-021, FR-157 to FR-160, FR-162, FR-185', 'FR', 'C-3', 'H3', 'in-progress'],
  ['TASK-ZAI-041', 'SPR-ZAI-02', 'Identity lifecycle: grants, Employment and LegalEntity, invites and SoD, audit access evidence — FEAT-027 to FEAT-030, FR-191 to FR-199', 'FR', 'C-3', 'H3', 'review'],
  ['TASK-ZAI-042', 'SPR-ZAI-02', 'SmartGift catalog convergence through the seventeen-stage adapter — FEAT-026, FR-187 to FR-189', 'FR', 'C-3', 'H3', 'in-progress'],
  ['TASK-ZAI-043', 'SPR-ZAI-03', 'Apply every pending deliverable-11 migration on production and record it in the migration notes', 'NFR', 'C-2', 'H4', 'planned'],
  ['TASK-ZAI-044', 'SPR-ZAI-06', 'GATE-ZAI-09 evidence run: ERP modules accepted on production for Business one', 'NFR', 'C-2', 'H4', 'planned'],
  ['TASK-ZAI-045', 'SPR-ZAI-02', 'Knowledge file intake: Text/Markdown and FileAsset admission into an immutable raw artifact at Stage 1 — FR-173, FR-081, FR-109', 'FR', 'C-3', 'H3', 'review'],
  ['TASK-ZAI-046', 'SPR-ZAI-02', 'Tier 1 stage calculators, composition and quarantine, Stage 2 to 8 — FR-111 to FR-119', 'FR', 'C-3', 'H2', 'done'],
  ['TASK-ZAI-047', 'SPR-ZAI-03', 'Knowledge base console: source library, ingestion run status, corpus and generation registry, cited query', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-048', 'SPR-ZAI-03', 'Binary document parsing at Stage 2 (PDF, DOCX, HTML, tables, OCR) with raw mapping at Stage 3 and offsets at Stage 7 to 9', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-049', 'SPR-ZAI-03', 'Durable file storage, retention and recoverability for knowledge raw artifacts on production (spec §3.1)', 'NFR', 'C-3', 'H4', 'planned'],
  ['TASK-ZAI-050', 'SPR-ZAI-03', 'Activate the seventeen-stage runtime on production beyond the isolated profile: knowledge migrations recorded, MSP/GKS/worker reachable, one real corpus published', 'NFR', 'C-3', 'H4', 'planned'],
  ['TASK-ZAI-051', 'SPR-ZAI-03', 'Multi-source concurrency, scheduler and replay surface over the FR-081 ingestion boundary', 'FR', 'C-3', 'H3', 'planned'],
]
