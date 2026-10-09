# Coding-delivery workflow policy

**Status:** Selected for the supervised WF00 bootstrap only. This document and
[`contracts/model-policy.json`](contracts/model-policy.json) do not install a
runtime controller or grant product, Business, provider, or production
authority. The exact admission packet is
[`contracts/source-pins.json`](contracts/source-pins.json); its source hashes
are the immutable G0 preimage at `578b103e1556a4d9251b16cb1b3b07a866d21cfb`.

## Authority and boundary

The selected model-role, gate, concurrency, and finite-retry values have one
machine-readable authority in `contracts/model-policy.json`. The existing
model tables in S-01 and Document 20 remain historical profiles; their
role names, model choices, and receipts are not silently rewritten or carried
forward as current runtime policy. Documents 20 and 29 remain candidate
specifications. This WF00 packet selects a supervised documentation process;
future work packages require their own explicit G0 admission.

Root owns coding-delivery tooling under `tools/delivery-control/`. Its future
repository-local, non-product state root is the repository's git common
directory plus `zuri-delivery-control/`. This location stores workflow evidence
and control state only; it is not product data, an application database, a
Business namespace, or a permission grant. Schema and backend selection remain
pending a separately admitted WF02 node. WF00 creates neither the tooling nor
the backend.

No general autonomy or Business Fleet permission follows from this policy.
Persistent controller, PL01/PL02 pilot, and WF09 dispatch/acceptance remain
`NOT_IMPLEMENTED` / `NOT_RUN` as applicable. No scheduler, watchdog, automatic
provider action, external write, migration, deployment, or activation is
authorized by this document.

## Reusable packet contract

Every future packet must name one owner, base commit, exact source digests,
approved specification, explicit dependencies, exact allowed paths, forbidden
effects, acceptance checks, verification environment, output receipt, and
finite budget. The current G0 packet is docs-only. Its eight-file allowlist is
the complete writer scope; generated outputs remain generator-owned, and
canonical source rows, registries, readers, exports, IDs, and historical
receipts are outside that scope.

Before dispatch, the root checks every required source against the exact pinned
revision and proves the scope is ready. Missing or negative evidence blocks
progress. A hash mismatch, path escape, forbidden effect, unknown authority,
missing evidence, unavailable required model, failed command, skipped required
check, or unclear retry history cannot receive `PASS`. `NOT_RUN`, `UNKNOWN`,
`FLAKY`, `SKIPPED`, and `PARTIAL` remain distinct from `PASSED`.

Each worker submission identifies packet and lineage, attempt, acceptance
revision, writer identity, base and head SHA, changed paths, claim-to-evidence
map, actual commands and exit codes, environment, exact artifact digests,
limitations, and open gates. The verifier and reviewer use separate sessions
from each other and from the writer; each receipt names the exact revision,
session role, model, verdict, checked criteria, evidence, and remaining limits.
No model fallback or session-role substitution is allowed.

The independent verifier checks the exact submitted revision. The reviewer
checks that same verified revision and its evidence. Root alone composes the
accepted patch and checks the resulting exact tree. A semantic repair creates
a new submission revision and invalidates affected verification. A receipt
proves only the evidence class and revision it names; a local check does not
prove hosted CI, deployment, live Business use, or production acceptance.

The required gate order is worker submission → independent verification →
mandatory independent review → GPT-6.1-Sol task decision → GPT-6.1-Sol root
integration → exact-head hosted CI → GPT-6.1-Sol final gate → separate owner
release/activation decision when applicable → SOT closeout → safe cleanup.
The mandatory reviewer is a distinct session from both writer and verifier; a
missing receipt blocks. High-impact or uncertain task questions go to the
selected GPT-6.1-Sol decision role. If domain-owner, Business, provider, or
production authority is missing, park for that owner; model judgment cannot
replace it.

Hosted CI must be attached to the reviewed PR head SHA and required ancestors.
If the head changes, the affected review and CI evidence must be refreshed
before the GPT-6.1-Sol final gate and merge. `mergeable=true` alone is not
authorization. Integration is a single root-owned queue; shared contracts,
schemas, canonical rows, generated outputs, and target-branch changes are
serialized.

## Retries, unknown effects, and PARK

The numeric retry and lineage caps in `contracts/model-policy.json` are sealed
for this WF00 packet only; they are not global runtime defaults. Each future
node must seal its own finite values at G0. Within a packet, counters attach to
their original lineage and acceptance revision; rename, rebase,
candidate-version change, or a new chat does not reset them. Acceptance repair,
provenance successor, tool retry, review, recovery, RCA, escalation, and
circuit-probe actions are different classes and may not be relabeled to bypass
their limits. A tool retry is allowed only when the original operation's
idempotency and input revision are established. If a counter, model failure,
or prior effect cannot be established from evidence, record
`MODEL_UNAVAILABLE` / `UNKNOWN` and block for a decision instead of assuming
zero or falling back.

An external effect with unknown outcome becomes `UNKNOWN` and stays quarantined
until an authoritative receipt or state check resolves it. Do not blindly retry
or infer success from a local agent response. Parked work has a typed reason:
`STALE_BASELINE`, `SCOPE_BLOCKED`, `DEPENDENCY_BLOCKED`, `UNKNOWN_EFFECT`, or
`OWNER_DECISION_REQUIRED`. A PARK record includes packet/lineage/node identity,
reason code, exact evidence reference, accountable owner, next permitted action,
and whether a new admission is required. Unknown effects remain blocked even
when another deadline or retry limit is reached.

## Closeout and source of truth

Submission is not closure. Root closeout records worker, verifier, reviewer,
and integrated revisions; exact source and output digests; conflicts and
dispositions; commands and observed results; typed PARK states; and every
remaining gate with its owner and release condition. Reconcile status through
the owning canonical source of truth (SOT); then regenerate governed projections
from that source and check them. Never repair a stale projection by editing a
generated export or changing an immutable canonical row.

The closure receipt names the integrated revision and exact-headed hosted CI
when required, the canonical SOT reconciliation, projection/governance evidence,
and unresolved owner, provider, production, or activation gates. A delivery
merge does not close a separate live or production criterion. When a required
receipt is absent, closeout records `NOT_RUN` or `UNKNOWN` with the next owner;
it does not claim completion.
