# WF01 local delivery contracts

This folder contains strict JSON Schema 2020-12 contracts and a Node.js ESM validator for immutable task packets, delivery DAGs, per-packet execution DAGs, artifact acknowledgements, and typed PARK disposition mapping. The WF01 validator uses Node built-ins and local reads; it does not dispatch work, execute declared commands, call providers, contact a database, alter a ledger, merge code, or persist PARK records. The separate G0 helper writes local append-only preparation reservations and optional structural receipts only.

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

The WF01 validator does not load the current model-policy file or enforce its global
run counters, read-scope closure, deadlines, or recovery decisions. Root checks and
records those in the run manifest and append-only action receipts before dispatch.
The v1 packet/DAG budgets must fit inside the remaining root-lineage budget. New
control-plane metadata belongs beside the v1 documents, not in unrecognized schema
fields. Existing fixtures, park-map bytes, source pins, and historical receipts
retain their original meaning. This policy update supplies an agent procedure;
it does not claim a persistent controller or ledger is installed.

### Prepare G0 without spending execution repair capacity

The v3 policy requires a bounded draft preparation before reserving sealed G0.
`prepare-g0.mjs` loads the active machine policy and calls
`validateG0Preparation(preparation, packet, policy, { dependencyProofs })`.
It validates the existing packet plus a separate strict
[`g0-preparation/v1` sidecar](contracts/g0-preparation.schema.json), including
one command proof per criterion. The sidecar contains `policyVersion`,
`rootLineageId`, `packetDigest` (from `canonicalDigest(packet)`),
`mandateReference`, repository-relative `readSet`, and `acceptanceCommands`.
Each command has `criterionId`, `shell: false`, an absolute `executable`,
`argv`, an absolute `cwd`, and `environmentReceiptSha256` matching the packet.
Private instruction/evidence reads are reconciled separately by root; do not
insert `.git` or absolute paths into the repository `readSet`.

Choose one invocation below: the first validates without publication; the
second validates and publishes in one attempt. They are alternatives, not a
mandatory sequence. Running both consumes two preparation attempts, because
every valid CLI invocation creates its own reservation before reading candidates.

```powershell
node tools/delivery-control/prepare-g0.mjs --root-lineage-id TASK-EXAMPLE --packet .\packet.json --preparation .\preparation.json --dependency-proofs .\proofs.json
node tools/delivery-control/prepare-g0.mjs --root-lineage-id TASK-EXAMPLE --packet .\packet.json --preparation .\preparation.json --dependency-proofs .\proofs.json --publish
```

The helper requires an explicit stable `--root-lineage-id`, then reserves an
attempt before opening packet, sidecar or dependency-proof files. Malformed JSON
therefore consumes an attempt. Create-exclusive flat slots live under
`<git-common-dir>/zuri-delivery-control/preparation-attempts/` as
`<lineage-sha256>-attempt-<number>.json`; all linked worktrees and sessions share
them. It checks contiguous bound history and enforces the smaller of the active
cap and the original reserved cap. Corrupt, ambiguous, redirected or exhausted
history fails closed. Competing claims fail without waiting or automatic retry.
Claimed slots are never removed, overwritten or refunded, including a partial
write left by a crash. There is no per-lineage empty-directory state.

Root verifies terminal eligibility and existing full lineage history before
invocation, retains candidates/diagnostics, and still enforces the original
deadline and no-progress budget. This local ledger enforces only preparation
attempt capacity; it does not authenticate lineage identity, implement other
workflow counters or permit relabeling terminal work. Draft
failure does not reserve sealed G0, successor, submission or acceptance-repair
capacity. A successful result is `PREPARED_NOT_ADMITTED`, with
`authorityGrant: false` and `dispatchAllowed: false`. Root must perform the
remaining authority, pins, read closure, command/environment capability,
session, scope and budget checks before sealed G0 and dispatch. Prior terminal
lineages cannot be revived or have reservations refunded by this helper.

`--publish` writes only successful structural preparation receipts under
`<git-common-dir>/zuri-delivery-control/preparations/<byte-sha256>.json`. It uses
Node JSON serialization and round-trip validation, fsync and byte read-back,
then a create-only same-directory hard link. A duplicate destination is an
error and existing evidence stays untouched. Unsupported hard links or
redirected directories fail closed; no overwrite fallback exists. If the CLI
returns `PREPARATION_ERROR`, reconcile publication read-only before another
bounded attempt when publication is uncertain or applied, because an error
after linking may still have written the receipt. For `NOT_ATTEMPTED` with
effect `NONE`, record the candidate and diagnostic; Sol may prepare one corrected
draft only within the remaining preparation, deadline and no-progress budgets.
Neither path retries automatically. Errors return the exact intended `evidenceLocator` and
`temporaryLocator`, plus `publicationState` and `publicationEffectState` for
the final receipt. Path checks inspect each existing directory before creating
children; Windows comparisons normalize letter case and extended path prefixes.
The G1/G2 acceptance probes verified hard-link publication on the current
Windows host. That evidence is specific to this filesystem; validate support on
other target filesystems separately.

The persisted preparation record's `stateWritePerformed: false` is the pure
validator's result and means validation itself did not write state. The CLI's
top-level `stateWritePerformed: true` covers the reservation and optional
receipt publication performed by the helper. Use the reservation and evidence
locators to audit those helper-side writes.
This is local complete-file publication and preparation-slot reservation, not a
durable workflow controller, authority grant or storage durability guarantee.

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
