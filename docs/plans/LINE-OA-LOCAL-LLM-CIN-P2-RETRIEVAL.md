---
id: ZAI:LINE-OA-LOCAL-LLM-CIN-P2-RETRIEVAL
version: "0.2.0b"
status: beta
relations:
  - type: relates_to
    target: ZAI:LINE-OA-LOCAL-LLM-CIN-EXECUTION
---

# P2 published retrieval execution detail

This implements the owner-approved parent plan, section 6. Risk HIGH, C-3.

## Current contract and confirmed gap

`msp_pipeline_query` accepts text, topK and optional snapshotId. The pinned
GenesisBlock worker `7c9261c4a4d4193af4e2613db48896533eb28072` executes lexical
and vector chunk retrieval. It does not expose graph traversal or typed
price/budget filtering. `ontology_v2` stores PRICED_AT, HAS_COMPONENT and
IN_CATEGORY facts, but stored facts alone are not a query capability.

The worker's snapshot is one published source decision. The Server corpus
service federates published sources for a Business. The current Edge adapter
instead queries the latest pointer, so it cannot claim complete catalog
coverage when ingestion publishes records individually.

## Implemented boundary

One `wrapAnswerRag` instance belongs to one answer turn (the executor already
constructs it inside each execution). Pin the first valid snapshot/generation
and send the existing snapshotId selector on later calls. Serialize calls at
this boundary so concurrent tools cannot race two first reads. New turns get
fresh readers. Never switch to v4 after published evidence was consumed, or
switch to published evidence after a v4 fallback was consumed. Fallback still
requires the configured sunset to be in the future.

Reject wrong scope, malformed citations, content-hash mismatch and generation
changes as integrity failures; they cannot authorize an unscoped v4 fallback.
MSP tool errors likewise fail closed. Only transport availability failures and
unsupported operations may select the configured v4 fallback before any
published evidence. Diagnostic store failure cannot change answer selection.

## Typed product path

Server derives `edge-published-corpus.v1` from the persisted job's Business and
current authorized corpus. It rechecks active source/ingestion membership and
FileAsset permissions, then exports only the approved SMARTGIFT_CATALOG parser-2
source profile. Internal documents and chat candidates are excluded. Two batched
repository reads load ingestion and parsed-artifact metadata. The context is
bounded to 2048 sources and 1 MiB, expires within 60 seconds and carries the exact
corpus generation/hash plus source/snapshot/receipt/artifact refs. Completion must
compare fresh refs against the claim's persisted context summary.

`wrapAnswerRag(..., corpusContext)` pins this context for the whole turn and
fails unavailable without v4 fallback, including missing runtime or capability.
The new versioned MSP `msp_pipeline_product_query` relay enforces the existing
scope principal and fixed authenticated loopback worker URL. Worker validates
published snapshot membership and receipt before reading native SQLite/vector
and depth-1 Query IR graph lanes. Allowed relations are PRICED_AT,
HAS_COMPONENT and IN_CATEGORY. All rows retain full citation lineage and graph
proof. Native graph warnings, cap overflow, conflicts and deadlines fail closed.

Prices come only from explicit `srpUnitPriceThb` and `qty` fields in the
deterministic parser-2 descriptor, joined to a published PRICED_AT claim. Amounts
are integer THB minor units; tier identifiers are consistency checks, never
price sources. Quantity below MOQ yields no selected price. Budget filtering uses
the same verified quantity tier. Missing unit, validity, tax and shipping remain
null; outputs say catalog snapshot, and quote tools return no payable total or
RMB fallback. The final answer is formatted deterministically from typed evidence,
including exact catalog dates, product names/codes and verified human source labels.
Full source/snapshot/chunk refs stay in tool evidence, not customer prose. Model prose cannot
turn unknown tax, shipping, unit or validity into a confirmed quote or computed
total; Project/Work guards retain priority. No deployment pin is advanced by this slice.

The current handoff is Server-authoritative but not a signed corpus grant at the
worker. An already compromised Edge holding its scope's source credential can
query other historical published snapshots within that same scope, as the
existing query capability allows. Cross-scope queries are denied. A stronger
same-scope withdrawal threat boundary requires short-lived signed corpus grants
verified downstream, with signing keys withheld from Edge.

## Validation

Local evidence on 2026-09-17:

- Edge retrieval tests: 25/25; TypeScript check passed. Covers generation races,
  backend consistency, integrity, typed product provenance and non-quotable prices.
- Server corpus/helper tests: 22/22; source withdrawal, ingestion replacement,
  permissions, parser lineage and metadata batching verified.
- MSP relay contract: 10/10; product security tests: 3/3.
- Full MSP regression: 445 Vitest tests passed with one existing skipped test;
  security suite 148/148 passed, zero skips (includes real expiry waits).
- GenesisBlock native product tests: 5/5 with `P2_MSP_ROOT` supplied, no skips.
  Rebuilt the pinned native source with `cargo build --release --offline` because
  the pre-existing local addon did not implement the current Query IR budget.
  The real MSP subprocess -> authenticated worker HTTP -> native vector/graph
  fixture round trip plus denial probes took 967 ms for two synthetic sources.
- Existing GenesisBlock worker regression suite: 20/20, no skips, using its
  locally pinned e5 artifact. Initial sandbox run denied Python spawn; rerun with
  local subprocess permission passed. This separate regression run does not
  validate the new product query against a real catalog.

The native test uses synthetic four-dimensional embeddings and fixture snapshot
publication metadata. It proves the physical query/relay path, not the real
427-product catalog, e5 relevance, full 17-stage publication, physical LINE
delivery or deadline performance at catalog scale. Those acceptance gates remain
NOT_RUN. Source tests are in the isolated MSP/GenesisBlock worktrees on branch
`codex/line-oa-p2-products`, based on MSP `4ca98c3008d43c6295e886a2c1382d49172d274f`
and GenesisBlock `7c9261c4a4d4193af4e2613db48896533eb28072`.

Isolated implementation commits (not deployed): MSP
`d7451b5d82e66ef45d0044325b4726be02b0eb31`; GenesisBlock
`cd6441d7a02f655cb8ad9976d555d50f066d515c`. GKS requires no code change for
this parser profile: its existing ontology_v2 assertions supply canonical facts.

## Version diff

0.1.0b -> 0.2.0b: added typed corpus/product implementation and bounded local
native/process evidence; preserved outstanding catalog-scale and deployment gates.
