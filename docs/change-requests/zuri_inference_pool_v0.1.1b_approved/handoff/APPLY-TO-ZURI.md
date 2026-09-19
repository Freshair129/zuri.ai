# Integration handoff — apply the documentation to Zuri, not production

## What this packet is

Twelve complete owner-approved design documents, written against the inspected baseline and the actual ADR/FR/FR-phase template structure. Only global numeric ID slots remain unbound. The slot tokens are deliberate, not missing design text. Files use `.md.template` until an integrator binds approved unused IDs; this is the same staging extension used by the repository's templates.

Approval was received after v0.1.0b. See review/APPROVAL-RECORD.json. Canonical IDs and registry integration remain pending; any separate approval-record PR must not be mistaken for the twelve documents being integrated. No migration, key or deployment was created. This packet is not proof that repository-wide governance or application tests passed.

## 1. Reconcile against current main and active lanes

Use a dedicated worktree under the repository's existing rules. Read current `AGENTS.md`, `CLAUDE.md`, `llms.txt`, `docs/GOVERNANCE-LINK-METADATA.md`, the touched charters, current PRD/FEATURES/ROADMAP and `docs/.id-ledger.json`. Enumerate tracked files and relevant open lanes; a search miss is not proof that a parallel design does not exist.

The reviewed baseline is `cfd5521e7d004e63ffead1e07f46045f1cdc06f2`. If main differs, compare the Server provider policy, LINE jobs/deadline, Integration secret provisioning, observer/operations ownership and the generated-document policy before adopting text. Do not overwrite an existing registry from a snapshot in this packet.

## 2. Approve and bind IDs without recycling published meanings

The map needs one ADR, one FEAT, five FR, two SEC, two SDD and two NFR IDs. The feature groups only the five new FRs. Do not reassign FR-149/150 or provider FRs from their existing features. Review numeric availability in the ledger, registries and active branches, not by taking a maximum from a partial listing.

Copy `id-map.example.json` to a working `id-map.json`, and fill the 13 null fields with the reviewed identifiers (`ADR-...`, `FEAT-...`, etc.). No number in the sample is a reservation. The subject strings in `registry-rows.json.template` are the proposed leading phrases to pin, not aliases for existing requirements.

Render into a new **staging directory outside the target repository**:

```bash
node tools/render-drafts.mjs --map /absolute/path/id-map.json   --output /absolute/path/new-zuri-docs-staging   --repo /absolute/path/zuri-review-worktree
```

The renderer performs a read-only collision scan of the supplied checkout and refuses to overwrite output. It never writes the ID ledger, PRD, working tree or Git state. It cannot reserve numbers in other active branches or certify approval; the integrator must reconcile those explicitly.

## 3. Place source documents and compose registries

Copy only rendered `docs/**` approved design sources into the reviewed worktree after canonical IDs have been reconciled. Use rendered `handoff/registry-rows.json` as row content for the existing registry tables; it is not a replacement PRD. Preserve the exact current table columns, immutable existing subject anchors, versions, version history and other lanes' additions. Declare new rows as approved design/planned implementation, never implemented without evidence.

Update `docs/FEATURES.md` with one new bundle row and only its five FRs. Add scoped delivery work to the current ROADMAP after task IDs are properly allocated; no task/PR IDs are assigned in this packet. Keep software completion separate from deployment evidence. Link the domain-phase plan rather than duplicate all prose into the roadmap.

The source requirement files link to global numeric requirement nodes; they cannot pass a full graph build until the global rows exist. Binding placeholders alone is not sufficient.

## 4. Apply the charter/contract deltas deliberately

| Existing authority | Proposed change after approval | Explicitly not transferred |
|---|---|---|
| Integration | Describe node/pool management, protected private inference transport, normalized observations and proposed models; use existing secret abstractions | CRM/LINE job state, business tools |
| Agent | Describe self-hosted provider selection, router, database capacity leases, context/tool/parity and uncertain-attempt handling | LINE sending, MSP/GKS stores |
| LINE OA Studio | Describe proposed SELF_HOSTED_ONLY policy, pool/job snapshot and inference cutover | Provider credentials, GPU management |
| Platform Control | Add a removable operator projection and redacted read/action handoff | Operational source of truth, Business access or critical scheduler |
| Identity | Reuse correct Business/step-up/operator capabilities; amend only if a new explicit capability is needed | No grants inferred from role labels |
| Knowledge / CRM | Review existing port/receipt invariants for parity; add no duplicate writer | No direct GPU database credentials |

Planned models: Integration's `InferencePool`, `InferencePoolMember`, `InferenceNodeObservation`; Agent's `InferenceCapacityLease`. Describe them as proposed until the implementation lands. Do not add nonexistent models to `owns_models` or fake source/test annotations to make documentation coverage look complete. New production schema changes require same-change migration files and separate operator application.

Amend—not wholesale supersede—the affected behavior of ADR-061 and the provider restrictions after explicit approval. Keep existing LOCAL_ONLY and optional Edge meanings. ADR-089's LINE-specific secret entry does not automatically authorize model-key provisioning; the new purpose and adapter must be reviewed under the existing SecretStorePort. Preserve exact existing scopes and secret-store selection rules.

## 5. Use the sanctioned ID writer and generators

After the new canonical rows/ADR exist and the integrator has reconciled shared versions:

```bash
npm run docs:ids -- --write
npm run govern
```

The first command is the explicit sanctioned ledger writer. Never hand-edit `.id-ledger.json` or put this writer inside the governance gate. The governance command resolves graph/link metadata and rebuilds/checks derived views under the current repository scripts. Run one integrator's regeneration over the composed tree, not concurrent graph writers.

Generated view handling follows **current** repository policy. Some old prose tells contributors to commit all generated files, while the current README/llms guidance says `llms-full.txt` is built rather than committed. Build it when required by current scripts, but do not force-add ignored corpora or copied historical graph JSON. Commit only tracked/generated outputs current policy actually requires. Read the current scripts and ignore rules at integration time.

Update hand-written source navigation such as `llms.txt` only if appropriate. `FEATURE-MAP`, `DOMAIN-MAP`, `TRACE`, `DOCUMENT-LINKS` and graph/preflight data are not manually maintained requirement sources.

## 6. Verify and record honest status

Run current repository verification and affected contract tests from the correct app boundaries. Root npm commands delegate to Server; Edge has a separate installation/build boundary. Cross-app contract tests need both dependency trees. Use current scripts rather than assuming a historical test count or platform.

```bash
npm --prefix apps/server ci
# Required when the selected contract/governance checks consume Edge dependencies:
npm --prefix apps/edge ci
npm run govern
npm run verify
```

These commands are integration guidance, not a statement they ran in this packet's environment. For a docs-only change, record exact gates actually run and distinguish unavailable dependencies from passing tests. Hardware and live LINE cases remain NOT RUN until their own receipts exist.

## 7. Bound authorization

The user approved the reviewed documentation. Do not use this packet as permission to provision credentials, modify home networking, start a paid GPU, apply a migration, message a real LINE account or change the shared Compose deployment. A later implementation/activation instruction must preserve the proposal's authority and rollout gates.
