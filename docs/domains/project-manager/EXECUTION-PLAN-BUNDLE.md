---
domain: project-manager
doc_type: design-contract
version: 1.0.0
status: accepted
last_updated: 2026-08-26
---

# ExecutionPlanBundle — self-contained multi-project planning package

`ExecutionPlanBundle` is the outer planning artifact used when one import must carry Business strategy plus multiple Projects. It sits above the existing `PlanEnvelope`; it does not replace it.

Normative decision: [ADR-049](../../decisions/ADR-049-EXECUTION-PLAN-BUNDLE-IMPORT-ORCHESTRATION.md).
Normative schemas: `contracts/execution-plan-bundle.schema.json` and `contracts/plan-envelope.schema.json`.

## 1. Why this exists

The current Project Manager intake is deliberately Project-scoped. Human form, JSON, Excel and Agent/API/MCP input converge on a `PlanEnvelope`, then pass through schema validation, semantic validation, dry-run, authorization, transactional commit and AuditEvent recording.

A programme-level artifact has a wider shape:

```text
Business Roadmap
  ├── Horizon H1
  ├── Horizon H2
  └── Goals
       ├── Goal A
       └── Goal B

Projects
  ├── Project P01 → PlanEnvelope P01
  ├── Project P02 → PlanEnvelope P02
  └── Project P03 → PlanEnvelope P03

Cross-project dependencies
  └── P01 blocks P02
```

Without an outer package, an Agent must submit multiple unrelated files and the Human cannot validate the whole programme before the first Project is written.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| `ExecutionPlanBundle` | Transport/package artifact for one programme-level import |
| `PlanEnvelope` | Canonical import contract for one Project and its Workstreams |
| `WorkContainer` / `container` | Existing PM entity inside a Workstream; never the outer bundle |
| bundle-local ref | Symbol valid only inside one bundle, e.g. `GOAL-KNOWLEDGE` |
| canonical ID | Server-owned UUID after scope resolution/create/update |
| Bundle Import Orchestrator | Application-level coordinator that resolves the package and reuses existing services |
| bundle receipt | Idempotency/audit record for one accepted bundle occurrence; additive to Project-level PlanImportReceipt |

## 3. Contract layers

```text
ExecutionPlanBundle                   transport/orchestration contract
│
├── manifest
├── scope
├── strategy
│   ├── roadmap
│   ├── horizons[]
│   └── goals[]
│
├── projects[]
│   ├── bundleProjectRef
│   ├── workspaceCode?                bundle routing hint, never authority
│   ├── goalRefs[]                    bundle-local symbols
│   └── plan                          canonical PlanEnvelope
│
├── dependencies[]                    cross-project bundle refs
└── trace

PlanEnvelope                          canonical per-Project import contract
└── project → workstreams → containers/items/milestones/gates/dependencies
```

The outer bundle owns only package composition and cross-object resolution. Project semantics remain owned by `PlanEnvelope` and its existing importer.

## 4. Minimum bundle shape

A valid bundle contains:

1. `kind = EXECUTION_PLAN_BUNDLE`;
2. `schemaVersion = 1.0`;
3. a manifest with a stable bundle code and title;
4. one Business scope code plus optional default Workspace code;
5. at least one Project entry containing a valid `PlanEnvelope`;
6. optional Business strategy records;
7. optional cross-Project dependencies; and
8. trace metadata including an idempotency key when the caller needs replay-safe commit.

Example:

```json
{
  "kind": "EXECUTION_PLAN_BUNDLE",
  "schemaVersion": "1.0",
  "manifest": {
    "code": "ZURI-KNOWLEDGE-2026",
    "title": "Zuri Knowledge Intelligence Program"
  },
  "scope": {
    "businessCode": "BIZ-ZURI",
    "defaultWorkspaceCode": "WS-DEVELOPMENT"
  },
  "strategy": {
    "roadmap": {
      "code": "RM-KNOWLEDGE",
      "title": "Knowledge & Agent Intelligence"
    },
    "horizons": [
      { "ref": "H1", "key": "H1", "label": "Foundation", "position": 1 },
      { "ref": "H2", "key": "H2", "label": "Knowledge Infrastructure", "position": 2 }
    ],
    "goals": [
      {
        "ref": "GOAL-KNOWLEDGE",
        "code": "GOAL-KNOWLEDGE",
        "title": "Canonical knowledge operational",
        "horizonRef": "H2"
      }
    ]
  },
  "projects": [
    {
      "bundleProjectRef": "PROJECT-GKS",
      "goalRefs": ["GOAL-KNOWLEDGE"],
      "plan": {
        "schemaVersion": "1.2",
        "scope": { "workspaceCode": "WS-DEVELOPMENT" },
        "project": { "code": "P-GKS", "name": "GKS Knowledge Authority" },
        "workstreams": []
      }
    }
  ],
  "dependencies": [],
  "trace": {
    "correlationId": "planning-session-2026-08-26",
    "idempotencyKey": "zuri-knowledge-2026-v1",
    "sourceType": "AGENT"
  }
}
```

The full schema is the source of truth; the example above is illustrative.

## 5. Bundle-local references

### 5.1 Why symbolic refs are necessary

A self-contained Agent artifact is authored before new database UUIDs exist. It therefore cannot truthfully write:

```json
{ "goalIds": ["7f3a...server-uuid..."] }
```

for a Goal that the same artifact intends to create.

The bundle instead uses a local symbol:

```json
{ "goalRefs": ["GOAL-KNOWLEDGE"] }
```

The symbol is scoped to the bundle and has no authority outside it.

### 5.2 Resolution rule

```text
strategy.goals[].ref
  → validate uniqueness inside bundle
  → resolve/create/update BusinessGoal in authorized Business
  → obtain BusinessGoal.id
  → replace project.goalRefs[] with canonical project.goalIds[]
  → pass the resulting PlanEnvelope to existing dryRunPlan/commit path
```

The same pattern applies to Roadmap/Horizon relationships and cross-Project dependency refs.

### 5.3 Fail closed

The resolver rejects:

- duplicate refs;
- missing refs;
- a ref whose declared type differs from the referenced object;
- an existing object outside the authorized Business/Workspace;
- an ambiguous external mapping; and
- a bundle that attempts to use a display label as authorization input.

## 6. Import lifecycle

### Phase A — intake and authorization ceiling

```text
request/session
  → resolve trusted viewer
  → resolve target Business/Workspace ceiling
  → compare bundle scope to allowed scope
  → refuse before preview if unauthorized
```

Authorization is not delayed until commit. A dry-run of another tenant's bundle would itself disclose data.

### Phase B — package validation

```text
ExecutionPlanBundle JSON
  → JSON schema validation
  → kind/version check
  → unique bundle refs
  → Roadmap/Horizon/Goal reference integrity
  → unique Project refs
  → cross-project dependency reference integrity
```

No persistence occurs in this phase.

### Phase C — strategy dry-run

The orchestrator determines what the strategy section would do:

```text
Roadmap     → INSERT | UPDATE | CONFLICT | NOOP
Horizon[]   → INSERT | UPDATE | CONFLICT | NOOP
Goal[]      → INSERT | UPDATE | CONFLICT | NOOP
```

It produces a deterministic resolution map without yet committing:

```text
GOAL-KNOWLEDGE → existing/new BusinessGoal candidate
PROJECT-GKS    → nested PlanEnvelope candidate
```

### Phase D — nested PlanEnvelope dry-run

For each Project entry:

1. resolve its Workspace from the authorized target/default/entry override;
2. materialize canonical IDs resolved from bundle symbols;
3. call the existing PlanEnvelope dry-run;
4. retain its inserts/updates/conflicts and identity resolution; and
5. do not write anything.

This is the architectural invariant that prevents the bundle from becoming a second Project importer.

### Phase E — cross-Project dependency validation

Cross-Project dependency refs are validated only after every nested Project has a successful identity candidate. The preview must show source, target and dependency type using both Human codes and resolved/candidate IDs when available.

### Phase F — combined preview

The Human sees one preview such as:

```text
Target
  Business: BIZ-ZURI
  Default Workspace: WS-DEVELOPMENT

Strategy
  Roadmaps: 1 insert
  Horizons: 2 inserts
  Goals: 1 insert

Projects
  P-GKS: 1 Project, 3 Workstreams, 18 Items
  P-MSP: 1 Project, 2 Workstreams, 11 Items

Cross-project dependencies
  PROJECT-MSP → PROJECT-GKS : BLOCKS

Conflicts: 0
```

The confirm action remains disabled while any bundle-level or nested PlanEnvelope conflict exists.

### Phase G — confirmed commit

For current PM-owned records sharing one database, the preferred implementation is one transaction. The orchestrator orders writes so references exist before dependants:

```text
BusinessRoadmap
  → Horizons
  → Goals
  → nested Project/PlanEnvelope writes
  → cross-Project Dependencies
  → bundle receipt / audit lineage
```

The nested Project portion must reuse/extract the canonical PlanEnvelope commit logic rather than duplicate it.

If a future bundle spans an external owner that cannot join the transaction, use the coordinated mode from ADR-049 D8 and expose partial failure explicitly.

## 7. Idempotency and replay

`trace.idempotencyKey` identifies one logical bundle submission. Before first commit, the server calculates a hash from the normalized bundle.

Rules:

- same key + same normalized payload → return/replay the prior receipt;
- same key + different payload → conflict;
- retry after transport failure must not duplicate records;
- Project-level PlanImportReceipts remain valid and are linked from the bundle receipt;
- replay never mutates historical audit receipts to make the first run look successful.

## 8. Security rules

1. **Bundle content is data only.** No nested script, command, prompt or tool instruction is executed because it appeared in the artifact.
2. **Trusted viewer wins over payload scope.** `businessCode`/`workspaceCode` are selectors within the viewer's ceiling, never authority.
3. **Dry-run is authorized like commit.** No cross-tenant preview oracle.
4. **External IDs are mappings, not primary keys.** Existing BR-002/FR-070 rules remain.
5. **Unknown refs fail closed.** No auto-creation from labels.
6. **One intake lane.** New UI/API/Agent surfaces add adapters, not writers.

## 9. Atomic versus coordinated commit

### Atomic mode — preferred for current Project Manager scope

Use when all affected models are owned by the same database transaction. Benefit: a failed Project or dependency leaves no partial programme state.

### Coordinated mode — only when an external owner is unavoidable

Use when a future object belongs to another service/database. The orchestrator must then persist step receipts and explicit state:

```text
VALIDATED
→ STRATEGY_COMMITTED
→ PROJECTS_COMMITTED
→ DEPENDENCIES_COMMITTED
→ COMMITTED
```

Failure becomes `PARTIAL_FAILURE` or `ROLLED_BACK`; it is never reported as a successful atomic import.

## 10. Non-goals

This contract does not:

- introduce an `ExecutionPlanBundle` database table as a business object;
- replace `PlanEnvelope`;
- rename `WorkContainer`;
- allow arbitrary files/ZIP contents to execute;
- let an Agent bypass Human confirmation for a normal interactive import;
- turn Roadmap into a Project or Workstream; or
- grant permissions from bundle metadata.

## 11. Implementation shape

Target module shape:

```text
src/modules/project-manager/import/
  plan-import-service.js             existing per-Project contract
  bundle/
    bundle-schema.js                 runtime validator derived/aligned with JSON Schema
    bundle-resolver.js               bundle-local ref + scope resolution
    bundle-dry-run.js                combined preview orchestration
    bundle-commit-service.js         coordinated commit, reusing PM application services
    bundle-receipt.js                idempotency/audit lineage
```

Target surface shape (implementation tranche, not created by this document):

```text
POST /api/import/bundle/dry-run
POST /api/import/bundle/commit

Project Manager import UI
  ├── Human Plan Builder
  ├── Excel
  ├── PlanEnvelope JSON
  └── ExecutionPlanBundle JSON/file
```

The implementation tranche must declare new FR/SDD/SEC IDs before route/code creation, following ADR-039.

## 12. Compatibility

Existing callers are unchanged:

```text
Human form ─┐
Excel ──────┼──> PlanEnvelope ──> existing import pipeline
Agent JSON ─┤
API/MCP ────┘

ExecutionPlanBundle ──> Bundle Import Orchestrator
                         ├── strategy application services
                         └── N × existing PlanEnvelope pipeline
```

`PlanEnvelope` remains independently importable and versioned. Bundle schema evolution must never silently change the meaning of a nested PlanEnvelope version.
