---
status: approved
version: "1.0.0"
created_at: "2026-10-22T00:00:00+07:00,Codex"
last_update: "2026-10-22T00:00:00+07:00,Codex"
approval_scope: repository-local-ddc-retirement-and-requirement-migration
---

# Retire Developer Delivery Control

## Purpose

Record the approved repository change that retires the developer-only Developer
Delivery Control (DDC) tooling and its operator surfaces. This migration does
not retire Zuri's business Project Manager, product approval gateway, business
agent admission, document governance, or the normal GitHub CI and release
controls.

## Scope

- Remove the repository-local task preflight, controller, supervisor, worker
  dispatch/observation pipeline, their CLI entry points, and their dedicated
  tests.
- Remove the DDC-only `/control/mission-control` and worker-observability API,
  roadmap tab, publisher projection, and Compose overlay.
- Replace active DDC instructions with a normal Git branch/PR workflow,
  targeted verification, independent review for substantive changes, and the
  repository's existing hosted CI gates.
- Retire FEAT-044 and FR-260 through FR-264 by recording the current source-row
  changes through the canonical document registry and the sanctioned ID ledger
  writer. Their IDs and subject anchors remain preserved and burned.
- Preserve historical evidence and local-only delivery data without treating
  them as an active workflow or deleting private/shared state.

## Explicitly retained

- `npm run govern`, `docs:registry`, `docs:graph`, document identity and
  inventory checks, and generated document views.
- `docs/architecture/VERIFICATION-POLICY.md`, `verification:plan`, and the
  existing Server, Edge, Conversation Runtime, Docker, and GitHub CI checks.
- The product Project Manager roadmap, PM Approval Gateway, business approval
  and admission workflows, Business Agent requirements, and their business
  state.
- Existing `/control/roadmap` and `/roadmap` behavior governed by FR-105 and
  FR-241, including their current operator and member boundaries.
- Historical DDC source documents, receipts, source pins, roadmap revisions,
  and local-only evidence. These are historical evidence and do not authorize
  current execution.

## Approval

The repository owner explicitly selected retirement of the entire DDC system
on 2026-10-22, rather than only discarding closed PR #703. This approved record
authorizes the bounded source and documentation changes above. It does not
authorize deployment, production data operations, credential revocation, or
deletion of shared/private local history.
