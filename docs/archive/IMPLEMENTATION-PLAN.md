# Implementation Plan

## Phase 00 — Bootstrap & Architecture

Outcome:
- standalone repo runs
- design tokens installed
- SQLite connected
- module boundary created
- base tests configured

## Phase 01 — Canonical Scope Model

Implement:
- Portfolio
- Tenant
- LegalEntity
- Business
- Branch
- Workspace
- local Person/Membership
- scope selectors

## Phase 02 — Project Core

Implement:
- Project
- Workstream
- Milestone
- Gate
- Dependency
- Repository
- ProjectRepository
- WorkContainer
- WorkItem
- audit

## Phase 03 — Universal Views

Implement:
- Overview
- All Work
- Table
- Timeline
- Dependencies
- Milestones & Gates
- filters/search
- command palette

## Phase 04 — Seven Execution Views

Implement all seven from the neutral core.

At least one seeded, working Workstream for every mode.

## Phase 05 — Progress Engine

Implement:
- seven strategies
- explanation/evidence output
- weighted Project roll-up
- deterministic unit tests

## Phase 06 — Agent Plan Import + Backup

Implement:
- PlanEnvelope validation
- dry-run
- transactional import
- duplicate/conflict handling
- snapshot export/import
- audit trail

## Phase 07 — Hardening

Implement:
- E2E tests
- keyboard navigation basics
- responsive layouts
- empty states
- error states
- data reset/seed
- final docs
- Zuri integration assessment

## MVP cut line

Do not continue into CRM/LINE/auth integration during these phases.
