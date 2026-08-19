---
domain: project-manager
feature: FR-083
module: project-manager
source: v2-native
version: "1.0.0"
created_at: "2026-08-19T00:00:00+07:00"
last_update: "2026-08-19T07:30:00+07:00"
status: "candidate"
---

# FR-083 — Development Overview Dashboard, Roadmap Stepper, and Workstream Execution Lanes

| Field | Value |
|---|---|
| **Feature** | FEAT-003 / FEAT-005 — Development Domain Experience |
| **Status** | Implemented (candidate) |
| **Date** | 2026-08-19 |
| **Relates to** | FR-003, FR-040, FR-041, FR-043, FR-059, FR-060, FR-068, FR-070, SDD-018, SDD-019, SDD-033, ADR-011, ADR-012, ADR-013, ADR-025 |

## User story

As an engineering leader, project manager, or team member entering the **Development** domain, I want to see an executive Development Overview Dashboard with Key Performance Metrics (Active Projects, Workstreams, Manpower, Gates), a Phase/Horizon Roadmap Stepper, and Workstream Swimlanes (`laneId`), so that I can quickly assess delivery health, strategic horizon progress, and execution track distribution without navigational ambiguity between Business-level and Project-level scopes.

## Requirements

1. **Development Domain Entry (`/projects`)**:
   - WHEN an authorized user navigates to `/projects` (Development domain entry), THEN the system SHALL render the **Development Command Dashboard** composed of:
     - **Executive Metric Tiles**: Total/Active Projects, Workstreams Count by Mode, Team Manpower & Capacity, and Delivery / Gate Health.
     - **Development Roadmap Stepper**: Horizontal phase/horizon progression visualizing strategic horizons (e.g. Foundation ➔ Core Scale ➔ Expansion), current active stage, horizon goal count, workstream volume, and target dates.
     - **Active Projects Portfolio Matrix**: Portfolio card grid showing project progress bars, execution mode badges, spaces, and direct actions.
     - **Workstream Swimlane Distribution (`laneId`)**: Categorized view of workstreams grouped by execution swimlane track.

2. **Workstream Execution Lane (`laneId`)**:
   - The `Workstream` model SHALL support an optional `laneId` attribute (e.g. `LANE-CORE`, `LANE-INTEGRATION`, `LANE-DATA`, `LANE-UI`, `LANE-QA`, `LANE-OPERATIONS`).
   - The system SHALL allow creating, updating, and filtering workstreams by `laneId` in the Workstream form modal and Project details view.
   - PlanEnvelope import and validation schemas SHALL accept and preserve `laneId`.

3. **Navigation & Scope Disambiguation**:
   - The Sidebar SHALL strictly represent **Business-level Development Capabilities** (`Projects`, `All Work`, `Execution`, `Timeline`, `Dependencies`, `Milestones & Gates`, `Files`, `Repositories`).
   - Project-internal tabs (`ProjectTabs`) SHALL strictly represent **Project-Scoped Dimensions** for the selected project, with unbuilt sections kept clear to eliminate visual redundancy.

## Acceptance criteria

- [x] AC-083-01 Development domain entry `/projects` displays the executive KPI metrics and Development Roadmap Stepper.
- [x] AC-083-02 `Workstream` entity supports `laneId` persistence and indexing across SQLite and PostgreSQL runtimes.
- [x] AC-083-03 `WorkstreamModal` and Project details view allow inspecting and editing `laneId`.
- [x] AC-083-04 Roadmap Stepper renders active horizons with linked goal counts, target dates, and progress indicators.
- [x] AC-083-05 All unit tests, governance preflight checks, and Next.js builds pass cleanly.
