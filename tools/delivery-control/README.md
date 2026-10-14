# WF01 local delivery contracts

This folder contains strict JSON Schema 2020-12 contracts and a Node.js ESM validator for immutable task packets, delivery DAGs, per-packet execution DAGs, artifact acknowledgements, and typed PARK disposition mapping. It uses Node built-ins only and performs local reads. It does not dispatch work, execute declared commands, call providers, contact a database, alter a ledger, merge code, or persist PARK records.

## Current autonomous workflow

The [coding-delivery policy](../../docs/architecture/delivery-control/WORKFLOW-POLICY.md)
and [model policy](../../docs/architecture/delivery-control/contracts/model-policy.json)
govern the agents operating these tools. A delegated Sol root can be the accountable
`owner` and approval issuer within a recorded user mandate. The v1 contracts do not
require a human approver. The authority identity, scope, receipt binding, independent
sessions, and exact document digest still have to match.

For real admission, root records the mandate independently of the candidate packet
and validates the delivery/execution DAG with its separately obtained trusted
context. An `ok` structural result with `approvalContext: NOT_TRUSTED`, a fixture
result, or a context copied from untrusted packet contents cannot authorize dispatch.
Matching caller context proves a binding only; the caller must establish its origin.

The validator does not load the current model-policy file or enforce its global
run counters, read-scope closure, deadlines, or recovery decisions. Root checks and
records those in the run manifest and append-only action receipts before dispatch.
The v1 packet/DAG budgets must fit inside the remaining root-lineage budget. New
control-plane metadata belongs beside the v1 documents, not in unrecognized schema
fields. Existing fixtures, park-map bytes, source pins, and historical receipts
retain their original meaning. This policy update supplies an agent procedure;
it does not claim a persistent controller or ledger is installed.

## Validate locally

```powershell
node tools/delivery-control/validate.mjs --kind packet --input .\packet.json --dependency-proofs .\proofs.json
node tools/delivery-control/validate.mjs --kind delivery-dag --input .\delivery-dag.json --trusted-context .\trusted-context.json --dependency-proofs .\proofs.json
node tools/delivery-control/validate.mjs --kind execution-dag --input .\execution-dag.json --delivery .\delivery-dag.json --trusted-context .\trusted-context.json --dependency-proofs .\proofs.json
node tools/delivery-control/validate.mjs --kind fixture --input tools/delivery-control/examples/wf01-valid.json
```

The CLI reads only the explicitly named JSON inputs and prints a JSON verdict. Rejected inputs exit nonzero. A structural pass never grants authority, marks a dependency READY without proof, or writes state. For CLI dependency proofs, provide a JSON array with entries shaped as `{"artifactId":"...","bytesBase64":"...","trustedContext":{"authorityId":"...","acceptedReceipt":{...}}}`. The decoded bytes are compared with the artifact digest; the separately supplied context must repeat the exact accepted receipt binding. The validator never fetches artifact bytes.

`fixture` mode accepts only the isolated example format marked `fixtureOnly: true`. Its approvals, authority receipt identifiers, artifact receipt, and trust context are deliberately synthetic test values. A fixture-only pass is not a production approval or authenticated receipt.

## JavaScript API

`validate.mjs` exports:

- `validatePacket(packet, { dependencyProofs })`
- `validateDeliveryDag(deliveryDag, { trustedContext, dependencyProofs })`
- `validateExecutionDag(executionDag, { trustedContext, dependencyProofs, deliveryDag })`
- `canonicalDigest(document)`
- `verifyArtifactAck(artifact, actualBytes, trustedContext)`
- `verifyApproval(document, trustedContext)`
- `classifyPark(failureClasses, context)`

Dependency proof entries contain `artifactId`, a `Buffer` or `Uint8Array` in `bytes`, and a per-artifact `trustedContext`. Approval context is passed separately from the document. Results state `authorityGrant: false` and `stateWritePerformed: false`; `classifyPark` returns a validated intended record and says `durableWritePerformed: false`.

## Contract invariants

- Packet, delivery-DAG, and execution-DAG schemas have separate kind, schema version, and document-version fields. Unknown fields are rejected. Delivery and execution DAG approvals bind kind, revision, acceptance revision, canonical digest, and authority ID. The approval-receipt field itself is excluded from `canonicalDigest` to avoid a self-referential digest; all other document content, including acceptance criteria, is included.
- Delivery and execution DAG nodes have unique identities and acyclic dependencies. Delivery nodes have unique packet IDs and case-insensitively unique branches. Writes that overlap under case-insensitive Windows path comparison need a common declared lock whose concrete resource path covers the writes.
- Paths are concrete repository-relative slash paths. Absolute/drive/UNC paths, alternate streams, backslashes, globs, control characters, traversal, `.git`, case aliases, Windows device names, and trailing-dot/space aliases are rejected.
- Declared effects must include every requested effect. Bounded budgets require non-negative finite safe-integer counters, UTC deadlines ordered below the absolute deadline, and explicit stop conditions. Automatic acceptance repair is limited to two rounds. This validates the sealed bounds; it does not run a clock or enforce limits during execution.
- Required model mapping is `gpt-6.1-sol` for the Sol role set and `gpt-6-luna` at `max` for the Luna role set, with no fallback or substitution. Worker, verifier, and reviewer must have distinct session IDs bound to their exact roles.
- At each packet root, delivery-DAG node, and execution-DAG root, owner fields must be non-whitespace. The paired `authority.owner` must exactly equal `owner.ownerId`, and `authority.scope` must exactly equal `owner.scope` using case-sensitive raw string equality (no trimming or normalization). Owner domain is non-whitespace only; it does not imply a domain-rights proof. Schemas state the non-whitespace requirements and relation descriptions; executable validation enforces cross-field equality.
- Artifact references use `uri: "sha256:<digest>"`, a pinned producer commit and schema version, and an accepted receipt bound to the artifact digest and authority. Actual bytes and a caller-supplied trusted context are mandatory to return a receiver ACK. A producer's `READY` status is not accepted as proof.
- Every declared PARK route names a typed failure class, targets `PARK`, and binds the exact approved park-map digest. Multiple failures use the map's deterministic priority, with `UNKNOWN_EFFECT` first; unknown classifications fall back to `UNCLASSIFIED` and cannot produce `CLOSED`.

## Trust and persistence boundary

The validator checks that separately supplied trust context fields exactly match the document or receipt. It cannot authenticate who supplied that context, verify a digital signature, prove receipt provenance, or establish that a runtime used the selected model/session. The caller must obtain and authenticate those anchors outside this local tool. Cryptographic signatures and durable handoff are later work (WF05); persistent state, leases, and ledger writes are separate work (WF02). PARK results are intended records only and never claim that a durable transition occurred. This package is a contract validator, not an autonomous controller.
