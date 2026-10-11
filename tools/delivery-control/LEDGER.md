# WF02 local durable ledger

WF02 adds a synchronous, local SQLite execution ledger to the WF01 delivery-control tools. It records the lifecycle assertions and evidence supplied by its caller. It is not an authority service, a delivery-status source of truth, a distributed lock service, a provider adapter, or a workflow runner. It does not dispatch work or emit events outside the process.

## Runtime and storage boundary

Use the Node.js `v24.19.0` runtime selected for this packet and its built-in `node:sqlite` module. The selected `DatabaseSync` API is Stability 1.2 (Release candidate). The schema and API are in this folder; no package dependency is added. Keep `stateRoot` on a local filesystem shared by participating processes on the same host. WAL is not a multi-host consensus protocol and should not be placed on a network filesystem.

The caller must choose a task-owned local state root explicitly. This implementation does not select or activate a product, Git-common-dir, scheduler, or production database location. A ledger is keyed by a SHA-256-derived path below `<stateRoot>/ledgers/`; independent quarantine is below `<stateRoot>/quarantine/`. `CREATE_ONLY` uses exclusive file creation and refuses to overwrite or adopt an existing ledger. An existing quarantine marker blocks creation and reopen.

Each controlled write uses SQLite WAL, `synchronous=FULL`, `BEGIN IMMEDIATE`, and the finite 1000 ms SQLite busy wait. The application performs no transaction retry. A busy result is `BUSY`, with `durableWritePerformed: false`. Transactions do not span asynchronous work, filesystem operations, Git operations, dispatch, providers, or callbacks.

## Public API

Import from `tools/delivery-control/ledger.mjs`:

```js
import { createLedger, openLedger, getGenesisAnchor } from './ledger.mjs';

const created = await createLedger({ stateRoot, ledgerId });
if (!created.ok) throw new Error(created.code);
const anchor0 = created.anchor; // caller retains this independently
const ledger = created.ledger;
try {
  const receipt = ledger.admit({
    eventId: 'admit:node-17:r1', nodeId: 'node-17', acceptanceRevision: 1,
    packetId: 'packet-17', lineageId: 'delivery-control', attempt: 1,
    expectedVersion: 0, assignmentId: 'assignment-17', actor: 'worker-1',
    authorityReceiptRef: 'receipt:assignment-17',
    planDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64),
    inputDigest: 'c'.repeat(64), outputDigest: 'd'.repeat(64),
  });
  // Persist receipt.anchor outside this store before relying on it for later reopen.
} finally {
  ledger.close();
}

const reopened = await openLedger({
  stateRoot, ledgerId, expectedLedgerId: ledgerId,
  expectedPrefixAnchor: anchor0,
});
```

- `createLedger({ stateRoot, ledgerId })` is `CREATE_ONLY`. It returns `{ ok, code, ledger, anchor, durableWritePerformed }` on success. Close the returned connection with `ledger.close()`.
- `openLedger({ stateRoot, ledgerId?, expectedLedgerId, expectedPrefixAnchor })` requires an independent caller-supplied identity and `{ sequence, hash }` prefix. It never gets an anchor from the database it is checking. A valid later head is allowed when that exact prefix remains in the verified chain. Missing/malformed caller identity or anchor, or a selected identity different from `expectedLedgerId`, is rejected without touching or quarantining another store. After identity matches, a missing prefix, hash divergence, rollback, malformed history, or projection inconsistency triggers independent quarantine.
- Every successful admission/transition returns a receipt with `sequence`, `hash`, and `anchor`. The caller must retain that anchor outside the ledger. A missing caller anchor is not replaced with sequence zero.
- Results carry `ok`, a stable `code`, and `durableWritePerformed`. A failed write or ordinary rejection does not claim a persisted disposition. For quarantine failure, the result is `NEEDS_DECISION`, `persistence: "UNAVAILABLE"`, `durableWritePerformed: false`; callers must stop mutation and emission.

### Admission, lifecycle and canonical PR

`ledger.admit(input)` requires explicit `attempt >= 1`, `acceptanceRevision >= 1`, `expectedVersion: 0`, event/node/packet/lineage IDs, assignment ID, actor assertion, authority receipt reference, and all four SHA-256 plan/policy/input/output digests. Key identity is `(nodeId, acceptanceRevision)`. Each key has at most one immutable assignment and one immutable canonical observed PR. A terminal key is retained forever and cannot be readmitted or superseded in WF02.

`ledger.transition(input)` requires the stored assignment and actor assertion, explicit positive `expectedVersion`, an authority receipt reference, and a permitted `toStatus`. Allowed states start `READY`; `READY` may move to `RUNNING`, `COMPLETED`, `FAILED`, `DEFERRED`, or `NEEDS_DECISION`; `RUNNING` may move to the same terminal outcomes. CAS mismatch, wrong actor/assignment, and terminal transitions are rejected without mutation.

`ledger.bindCanonicalPr(input)` stores the caller-observed PR identity JSON and its observed receipt reference. It does not contact GitHub or prove the observation. An exact existing identity is idempotent; a changed identity or receipt is retained as conflict evidence, preserves the original canonical identity, and transitions the key to `NEEDS_DECISION`. Terminal lifecycle keys cannot bind or replace a PR.

Stable `eventId` values bind canonical request bytes. An exact replay verifies retained-prefix health and complete correspondence in the same SQLite snapshot before returning the original receipt before CAS; it adds no transition, assignment, or outbox row. A distinct-event losing admission returns a no-write CAS/terminal refusal. Reusing an event ID with different bytes on a nonterminal key retains both requests and appends the approved `NEEDS_DECISION` transition. On a terminal/PARK-fenced key, independent quarantine stops further actions while preserving its original disposition, receipt, canonical PR and outbox. A failed quarantine reports persistence unavailable and never claims a durable stop.

### PARK and local consumer application

`ledger.park(input)` accepts the full `classifyPark()` record and the exact approved `PARK_MAPPING_DIGEST`. It retains every input record field as raw JSON and records the mapping digest. Its separate lifecycle state is `PARKED`; the raw `nodeState`, `effectState`, closeout, and `runDisposition` are not flattened into that lifecycle label. PARK is terminal for local writes; this does not install WF03 lease fencing, remote revocation, or external-effect resolution.

`ledger.pendingOutbox({ consumerId? })` reads immutable outbox records in transition order; with a consumer ID it returns events not yet present in that consumer's inbox. It sends nothing. `ledger.applyOutboxEvent({ consumerId, eventId })` verifies the outbox digest and atomically inserts the unique `(consumerId, eventId)` inbox receipt, a concrete local consumer application row, and its local node projection. Reapplication returns `ALREADY_APPLIED`. Exactly-once applies only to that local database transaction; transport is at least once, and no external callback or side-effect exactly-once guarantee is made.

### Read methods

- `ledger.status({ nodeId, acceptanceRevision })` reads current node projection, canonical PR, and PARK record.
- `ledger.history({ nodeId, acceptanceRevision })` returns immutable transitions for one key in chain order.
- `ledger.health({ expectedPrefixAnchor? })` verifies SQLite integrity and full history/correspondence within a bounded consistent transaction. It always retains at least the caller prefix used to create/open the instance, strengthened by later verified in-process history. An optional additional anchor cannot weaken that floor; divergence quarantines. Only a newly created instance initially has genesis as its retained prefix. In-process memory does not replace independent durable caller receipt retention for reopen.
- `ledger.close()` closes the connection. Methods after close return/raise a closed-ledger error.

## Quarantine and preservation

Before readonly health validation, the opener snapshots the raw database, `-wal`, and `-shm` bytes (including explicit absence). It validates multi-query health in one SQLite read snapshot, checks path identity before writable open, then revalidates the same identity and history before applying controlled writable pragmas. Bad-history quarantine is a separate create-only directory, staged and atomically renamed, with a manifest containing the caller anchor, failure reason, original file identity, byte lengths, SHA-256 values, and evidence-only copies of raw files. The original DB/WAL/SHM are not renamed, repaired, checkpointed, vacuumed, overwritten, or used as a quarantine restore source. If independent quarantine cannot persist, the API reports `NEEDS_DECISION` and `durableWritePerformed: false` and stops.

Initialization failure after the exclusive path claim retains partial files and writes independent quarantine, with explicit persistence-unavailable reporting if that fails. Local task probes may observe synchronous `create.afterClaim`, `create.beforeCommit`, `create.afterCommit`, `transaction.beforeCommit` and resume milestones to terminate real processes. Probe hooks are isolated proof instrumentation, never application/provider callbacks. Transition row identities, retained assignment/PR/PARK bindings and canonical outbox bytes are checked against their exact hashed history, rather than trusting a payload self-digest alone.

The boundary assumes a trusted local owner and cooperative filesystem access. It cannot authenticate the caller, actor, authority receipt, or PR observation. It cannot detect a coherent rewrite or rollback older than the caller's independently retained prefix. SQLite `FULL` plus local filesystem semantics are not a hardware or remote durability attestation. Node's selected `node:sqlite` API is a release candidate; this packet's task-local probes are the evidence for the selected runtime only.

## JSON CLI

The minimal CLI consumes one UTF-8 JSON request file (a leading UTF-8 BOM is accepted) and prints one JSON result. Expected negative outcomes exit `2`; malformed CLI requests or runtime exceptions exit `1`; usage errors exit `64`.

```json
{"operation":"create","stateRoot":"C:/task-local-ledger-state","ledgerId":"wf02-local"}
```

After retaining the returned genesis anchor independently, later calls provide `expectedLedgerId` and `expectedPrefixAnchor`:

```json
{"operation":"admit","stateRoot":"C:/task-local-ledger-state","ledgerId":"wf02-local","expectedLedgerId":"wf02-local","expectedPrefixAnchor":{"sequence":0,"hash":"<genesis-sha256>"},"input":{"eventId":"admit:node-17:r1","nodeId":"node-17","acceptanceRevision":1,"packetId":"packet-17","lineageId":"delivery-control","attempt":1,"expectedVersion":0,"assignmentId":"assignment-17","actor":"worker-1","authorityReceiptRef":"receipt:assignment-17","planDigest":"<64-hex>","policyDigest":"<64-hex>","inputDigest":"<64-hex>","outputDigest":"<64-hex>"}}
```

Invoke with `node tools/delivery-control/ledger-cli.mjs request.json`. The supported operations are `create`, `open`, `admit`, `transition`, `bindCanonicalPr`, `park`, `pendingOutbox`, `applyOutboxEvent`, `status`, `history`, and `health`. The CLI closes all connections after one operation. Callers should retain the returned anchors and use them on their next invocation.
