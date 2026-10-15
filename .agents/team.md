---
status: active
superseded_by: null
version: "0.3.0"
---

# Developer team responsibilities

Assign responsibilities per task under the active
[coding-delivery policy](../docs/architecture/delivery-control/WORKFLOW-POLICY.md)
and its machine-readable [model policy](../docs/architecture/delivery-control/contracts/model-policy.json).
The root derives task readiness from the trusted mandate and backlog. Sol owns
decisions, critical debugging, orchestration, audit, integration and final
disposition. Exploration, research, worker delivery, verification and review use
the contract-bound sessions. The caller must bind the configured model;
model failure blocks that role without fallback or substitution.

| Stable role | Responsibility | Policy assignment |
|---|---|---|
| `dev-lead` | Derive task readiness from the backlog, inspect dependencies and risks, run automatic preflight | Sol root/orchestration |
| `dev-doc-writer` | Draft and reconcile documentation, diagrams and evidence | Doc Writer skill and native adapters; worker session when delegated |
| `dev-implementer` | Implement the admitted slice in its assigned worktree | Worker session |
| `dev-reviewer` | Independently review meaning, contracts, diff and evidence | Configured review session, separate from worker and verifier |
| `dev-verifier` | Execute relevant checks and return exact revision and results | Configured verifier session, separate from worker and reviewer |
| `dev-integrator` | Compose accepted sources, regenerate outputs and validate the combined result | Sol root integration; serialize shared-source generation |

Persona, domain expertise and role identity remain separate. Only Doc Writer has
a custom-agent role card, skill and native adapters in this package; the other
roles are selected and bound as distinct sessions by the orchestrator. The local
contract validator checks structure, but the actual dispatch also requires a
root-recorded mandate derived from a direct current user task or standing
delegation evidenced in trusted conversation/harness context, plus a verified
authority binding from that context. Root records the source message/reference,
repository, objective, effects and prohibitions once; task records reference it. The
user need not author or sign a packet, and no extra approval is required.

## Autonomous handoff

1. Root derives one task-readiness/v1 record from the task/backlog and trusted
   mandate: objective, acceptance, write scope, check commands and dependencies.
   Run tools/delivery-control/preflight.mjs; ordinary work has no packet,
   sidecar, sealed G0 admission, reservation or phase-receipt ceremony.
2. The worker implements the scoped task and returns its exact revision, changed
   paths, checks, results and remaining gaps.
3. A separate verifier and a third, distinct reviewer inspect the same revision.
   Tests and review may proceed independently against that frozen patch.
4. Sol owns one root delivery responsibility: resolve in-scope decisions,
   integrate accepted work, run generators serially, and check required tests,
   CI and authority before the authorized merge. Authorized commit, push and PR
   creation may collect pending CI.
5. Execute release/activation only when it is in the mandate and its actual
   target, environment grant and evidence exist. Missing external authority
   blocks the action; continue eligible independent work.
6. Reconcile roadmap/source-of-truth status with actual delivery evidence.
   Preserve evidence and confirm no active use before cleanup.

~~~mermaid
flowchart LR
    T[Task and trusted mandate] --> P[Automatic task preflight]
    P --> W[Scoped worker implementation]
    W --> V[Independent verification]
    W --> R[Independent review]
    V --> I[Sol integration and required checks]
    R --> I
    I --> C[CI on exact head]
    C --> M[Authorized merge and roadmap closeout]
    P -. metadata defect .-> F[Repair metadata]
    F --> P
    F -. repeated semantic no-progress .-> Y[Yield and reassess; task resumable]
    W -. unknown effect .-> U[Quarantine and read-only reconciliation]
    U --> Y
~~~

A READY result is local evidence, not authority. Root binds the trusted
conversation mandate; copied metadata cannot grant scope or external access.
Metadata repair with proven no product effect consumes no implementation budget
and starts no execution deadline. Repeated semantic no-progress yields
YIELD_REASSESS, retaining the same task identity. Implementation caps and
deadlines apply within the active execution cycle; an exhausted cycle pauses
work. A new numbered cycle requires material evidence or a corrected plan,
preserves prior history, and cannot recycle unchanged input. Unknown effects
require authoritative read-only reconciliation before any retry.

The diagram describes the agent procedure. No durable controller is claimed.
There is no routine human approval gate. Model bindings, cumulative no-progress
and per-cycle caps come only from the active machine policy. External authority,
independent sessions, mandatory tests and exact-head CI remain enforced.

## Version diff

0.1.0 to 0.2.0: autonomous v2 replaced manual approval handoffs; preserved here
as history, with its original active procedure superseded by v4.

0.2.0 to 0.3.0 (2026-10-15): uses ordinary automatic task preflight, one root
delivery responsibility, resumable metadata repair and bounded execution cycles.
Removes the obsolete packet/G0/terminal-task handoff procedure.
