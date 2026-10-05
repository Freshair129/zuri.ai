---
status: active
superseded_by: null
version: "0.1.0"
---

# Candidate governance bindings

## Symptom

Focused native receiver checks passed, but the first composed governance run could not qualify the candidate.

## Evidence

The initial pipeline created views before refreshing the graph and refused a stale operations view. After graph/view regeneration, strict preflight reported four critical findings: missing receiver in API Appendix A, stale handler count 331 versus 332, missing roadmap rows for FR-281–283, and 39 PostgreSQL model columns absent from the scanned production migration tree. DB Appendix B also omitted the three new models.

## Root cause

The candidate added its native route/models without completing their governed inventory bindings. PostgreSQL portability SQL was placed under `prisma/postgres/`, while the parent production-schema drift check intentionally reads only `supabase/migrations/`. The build order also generated views from a previous graph.

## Why the issue escaped detection

The opt-in native tests exercise isolated baseline-plus-candidate SQLite storage and do not run document inventories or the production migration-path checker. A structural PostgreSQL compile proves SQL compatibility, not its registration in the parent migration tree.

## Proposed prevention

Complete Appendix A/B, dedicated OpenAPI bearer documentation and planned roadmap rows with each new route/model; use the parent migration tree for the PostgreSQL mirror. Run graph generation before views, then composed governance before publication. Keep PostgreSQL receiver disabled, deny Data API/runtime access in its unapplied mirror, and retain separate native/live qualification gates. Do not widen ratchet baselines.
