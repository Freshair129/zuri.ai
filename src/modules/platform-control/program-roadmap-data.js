// @req FR-094 — one immutable projection of the submitted 24-week programme.
// @spec ADR-039 D3 — plan snapshot only; never a Git-derived completion claim.
// @tested tests/unit/platform-control-route-contract.test.js

export const PROGRAMME_SNAPSHOT = {
  documentId: 'ROADMAP-ZURI-AI-24W-PROGRAM',
  status: 'draft',
  version: '0.2.0',
  updated: '2026-08-20',
  baselineCommit: '6ad6ae9',
  programmeStart: '2026-08-24',
  programmeEnd: '2027-02-07',
  sourceLabel: 'Submitted 24-week programme',
}

export const PROGRAMME_DELIVERABLES = [
  'Visual Office 2.5D',
  'GoVibe Mission Control binding',
  'Interactive Node View 3D',
  'Second Brain / governed memory',
  'Five core agent roles',
  'Two cross-integrated Businesses',
  'Up to five automation workflows',
  'Up to three standard connectors',
  'L1–L4 approval, verification and notification',
  'Deployment, UAT, training and handover',
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
]

export const PROGRAMME_PHASES = [
  { id: 'PHASE-ZAI-01', weeks: 'W1–4', dates: '24 Aug – 20 Sep 2026', status: 'in-progress', progress: 8, goal: 'Consolidate the inherited foundation into a production-grade base', sprints: [
    { id: 'SPR-ZAI-01', weeks: 'W1–2', dates: '24 Aug – 6 Sep', status: 'in-progress', progress: 20, goal: 'Close identity, session and authorization to production standard' },
    { id: 'SPR-ZAI-02', weeks: 'W3–4', dates: '7 – 20 Sep', status: 'planned', progress: 0, goal: 'Settle tenancy, pipeline monitor and memory contract' },
  ] },
  { id: 'PHASE-ZAI-02', weeks: 'W5–8', dates: '21 Sep – 18 Oct 2026', status: 'planned', progress: 0, goal: 'Stand up the agent workforce and the governance ladder', sprints: [
    { id: 'SPR-ZAI-03', weeks: 'W5–6', dates: '21 Sep – 4 Oct', status: 'planned', progress: 0, goal: 'Build the agent role registry and five core roles' },
    { id: 'SPR-ZAI-04', weeks: 'W7–8', dates: '5 – 18 Oct', status: 'planned', progress: 0, goal: 'Add approvals, verification, notification and Mission Control binding' },
  ] },
  { id: 'PHASE-ZAI-03', weeks: 'W9–12', dates: '19 Oct – 15 Nov 2026', status: 'planned', progress: 0, goal: 'Second Business, governed analytics, workflows and connectors', sprints: [
    { id: 'SPR-ZAI-05', weeks: 'W9–10', dates: '19 Oct – 1 Nov', status: 'planned', progress: 0, goal: 'Business template, onboarding and isolation proof' },
    { id: 'SPR-ZAI-06', weeks: 'W11–12', dates: '2 – 15 Nov', status: 'planned', progress: 0, goal: 'Analytics, connector two and workflows one/two' },
  ] },
  { id: 'PHASE-ZAI-04', weeks: 'W13–16', dates: '16 Nov – 13 Dec 2026', status: 'planned', progress: 0, goal: 'Visual Office 2.5D and agent activity experience', sprints: [
    { id: 'SPR-ZAI-07', weeks: 'W13–14', dates: '16 – 29 Nov', status: 'planned', progress: 0, goal: 'Scene model, live reads and accessibility contract' },
    { id: 'SPR-ZAI-08', weeks: 'W15–16', dates: '30 Nov – 13 Dec', status: 'planned', progress: 0, goal: 'Agent presence and approval queue in scene' },
  ] },
  { id: 'PHASE-ZAI-05', weeks: 'W17–20', dates: '14 Dec 2026 – 10 Jan 2027', status: 'planned', progress: 0, goal: 'Second Brain, Node View 3D and remaining automation', sprints: [
    { id: 'SPR-ZAI-09', weeks: 'W17–18', dates: '14 – 27 Dec', status: 'planned', progress: 0, goal: 'Permissioned retrieval and replay lineage' },
    { id: 'SPR-ZAI-10', weeks: 'W19–20', dates: '28 Dec – 10 Jan', status: 'planned', progress: 0, goal: '3D node view, handoff contracts, workflows and connector three' },
  ] },
  { id: 'PHASE-ZAI-06', weeks: 'W21–24', dates: '11 Jan – 7 Feb 2027', status: 'planned', progress: 0, goal: 'Harden, prove, deploy and hand over', sprints: [
    { id: 'SPR-ZAI-11', weeks: 'W21–22', dates: '11 – 24 Jan', status: 'planned', progress: 0, goal: 'Integration hardening plus load and security campaign' },
    { id: 'SPR-ZAI-12', weeks: 'W23–24', dates: '25 Jan – 7 Feb', status: 'planned', progress: 0, goal: 'UAT, deployment, training and handover' },
  ] },
]

export const PROGRAMME_TASKS = [
  ['TASK-ZAI-001', 'SPR-ZAI-01', 'Close the production request-session and credential boundary', 'NFR', 'C-3', 'H3', 'in-progress'],
  ['TASK-ZAI-002', 'SPR-ZAI-01', 'Declare the four built-but-undeclared features into the registry', 'NFR', 'C-1', 'H1', 'ready'],
  ['TASK-ZAI-003', 'SPR-ZAI-01', 'Profile-first onboarding and Waiting Room, FR-066', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-004', 'SPR-ZAI-02', 'Workspace collaboration boundary and scoped invites, FR-067', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-005', 'SPR-ZAI-02', 'Supabase data pipeline monitor and replay, FR-071', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-006', 'SPR-ZAI-02', 'Write the governed memory read and write contract', 'NFR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-007', 'SPR-ZAI-03', 'Agent Role registry with five core roles', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-008', 'SPR-ZAI-03', 'Role-scoped memory partition and retrieval policy', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-009', 'SPR-ZAI-03', 'Agent Factory, the standard business agent template', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-010', 'SPR-ZAI-04', 'Approval Gateway L1 to L4 over the FR-026 action gate', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-011', 'SPR-ZAI-04', 'Verification and notification fabric on approval outcomes', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-012', 'SPR-ZAI-04', 'Bind GoVibe Mission Control to the Zuri mission feed', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-013', 'SPR-ZAI-05', 'Standard Business Template and provisioning path', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-014', 'SPR-ZAI-05', 'Onboard Business number two end to end under isolation', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-015', 'SPR-ZAI-05', 'Per-business visibility regression at two-business scale', 'NFR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-016', 'SPR-ZAI-06', 'Cross-business governed analytics read model', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-017', 'SPR-ZAI-06', 'Connector number two under the FR-081 ingestion boundary', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-018', 'SPR-ZAI-06', 'Automation workflows one and two end to end', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-019', 'SPR-ZAI-07', 'Visual Office 2.5D scene model and shell', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-020', 'SPR-ZAI-07', 'Bind Business, Agent, Mission and Approval objects to live reads', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-021', 'SPR-ZAI-07', 'Accessibility and reduced-motion contract for the 2.5D surface', 'NFR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-022', 'SPR-ZAI-08', 'Live agent activity presence and mission tracking in-scene', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-023', 'SPR-ZAI-08', 'Surface the L1 to L4 approval queue inside Visual Office', 'FR', 'C-2', 'H2', 'planned'],
  ['TASK-ZAI-024', 'SPR-ZAI-09', 'Second Brain retrieval by Business, Role and Permission', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-025', 'SPR-ZAI-09', 'Memory lineage, replay and the no-silent-replay guarantee', 'NFR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-026', 'SPR-ZAI-10', 'Interactive Node View 3D over the governed relation graph', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-027', 'SPR-ZAI-10', 'Structure and edge direct manipulation with handoff contracts', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-028', 'SPR-ZAI-10', 'Automation workflows three to five and connector number three', 'FR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-029', 'SPR-ZAI-11', 'Integration hardening plus load and security test campaign', 'NFR', 'C-3', 'H3', 'planned'],
  ['TASK-ZAI-030', 'SPR-ZAI-12', 'UAT, deployment, data and security checklist, training and handover', 'NFR', 'C-3', 'H4', 'planned'],
]
