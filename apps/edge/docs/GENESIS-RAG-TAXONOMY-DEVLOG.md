---
id: "GENESIS-RAG-TAXONOMY-DEVLOG"
version: "0.10.0b"
created_at: "2026-08-23T03:50:36+07:00, ATHER"
last_update: "2026-08-23T17:14:53+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P1 parser through P8 owner-logic review, plus P9 E5 embedding candidate resolution"
  parent: "GENESIS-RAG-TAXONOMY-CONTRACT"
  approval: "P0/P2/P3/P4/P5/P6/P7/P9 approved for bounded read-only execution by user command, 2026-08-23; activation pending"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# Genesis RAG Taxonomy — P1–P9 Implementation Devlog

## 1. Scope

P0 approval authorized the pure taxonomy parser, deterministic fixtures, and the
aggregate P2 review report. This entry records that implementation boundary and
its verification evidence.

Implemented:

- Unicode/case/whitespace/plus normalization
- approved P0 alias vocabulary
- packaging/commercial metadata stripping with evidence retention
- explicit multi-category bundle parsing
- deterministic component signatures with repeated components preserved
- review/unclassified statuses and reasons
- collision handling for World Cup, gift bag, mouse pad, card bag, and implicit separators
- family-level deterministic review report with provenance and unresolved policy
- aggregate-only summary that does not persist row-level business data
- P2 approval record and non-authoritative P3 projection boundary
- bounded P4 taxonomy preview service with manifest/count reconciliation
- shared read-only preview response for CLI and MCP
- explicit removal of arbitrary `execute_hql` from the MCP surface
- versioned query-only Thai aliases and P5 UAT evidence
- deterministic E5 ProductMaster candidate resolution with graph hard rules and no active-store mutation

Not implemented:

- persistent family/category mappings
- signed review approval for the 107 existing merge-review families and 222 taxonomy-review families
- production category serving/retrieval activation
- authoritative category filters, retrieval/runtime activation, or vector index
- price, quote, delivery, or inventory changes

## 2. TDD evidence

### RED

The new test file initially failed because src/rag/taxonomy.ts did not exist.
This confirmed the test was exercising the intended missing behavior.

### GREEN

The pure parser was added at src/rag/taxonomy.ts and the targeted suite passed:

- 14 tests passed
- 0 failures
- coverage includes simple aliases, bundles, wrappers, collisions, unknowns,
  implicit separators, duplicate components, and replay determinism

### Additional verification

- npm run typecheck: passed
- current pricing snapshot read-only replay: 1,017 rows classified
  - auto: 775
  - review_required: 230
  - unclassified: 12
- no classification output was persisted to a database or source file

The replay distribution is an engineering diagnostic only. It is not a P2
business approval or a production taxonomy report.

### P2 report GREEN

The family-level report builder was added at src/rag/taxonomy-report.ts.
The targeted report suite passed:

- 2 report tests passed
- 0 unexplained auto assignments in the source snapshot
- aggregate result: 845 families, 611 auto, 222 review_required, 12 unclassified
- candidate category count: 29; approved category count: 0
- bundle family count: 753; canonical offers: 1,016; variants: 1,016
- existing merge-review families reconcile to taxonomy status: auto 102,
  review_required 5, unclassified 0; total 107

The aggregate report is recorded in
docs/GENESIS-RAG-TAXONOMY-REVIEW-REPORT.md. Full family rows remain local/in-memory
and are not written to Git or the database.

### P3 projection GREEN

- pure projection builder and store lifecycle implemented;
- first native materialization: `ingest_empty_store`;
- replay: `skip_same_snapshot`;
- result: 2,906 nodes and 4,479 edges;
- 2,447 `CANDIDATE_CATEGORY` edges and 0 `BELONGS_TO_CATEGORY` edges;
- projection status `proposed`, `activated: false`, vector `not_built`;
- evidence recorded in docs/GENESIS-RAG-TAXONOMY-PROJECTION-REPORT.md.

### P4 serving GREEN

- contract recorded in `docs/GENESIS-RAG-TAXONOMY-SERVING-SPEC.md`;
- `src/rag/taxonomy-serving.ts` provides deterministic `taxonomy-serving-v1` preview;
- category, family, bundle, variant, and offer counts are returned separately;
- exact code lookup preserves canonical offer/variant/family identity and provenance;
- CLI `taxonomy preview` and MCP `taxonomy_preview` use the same pure service;
- MCP readiness awaits Genesis initialization and reports v2 catalog plus proposed
  taxonomy projection readiness separately;
- `execute_hql` was removed from MCP; no arbitrary HQL/SQL execution was introduced;
- targeted taxonomy suite: 28 passed, 0 failed;
- CLI bounded UAT: `drinkware`, limit 1 returned `projectionStatus: proposed`,
  `activated: false`, and `vectorStatus: not_built`.

### P5 UAT GREEN / activation HOLD

- Thai query aliases `แก้ว`, `ร่ม`, and `ปากกา` pass through
  `taxonomy-query-alias-v1` without changing canonical taxonomy or projection counts;
- exact code `TMK0514` preserves family/variant/offer identity;
- `drinkware+pen` and `drinkware+pen+usb_flash_drive` have 3 and 2 families,
  respectively, with zero family-ID overlap;
- unclassified visibility, bounded-input rejection, and snapshot-drift rejection pass;
- current snapshot reconciles to 29 candidate / 0 approved categories, 845 families,
  753 bundles, 1,016 variants, and 1,016 offers;
- full UAT/verification evidence is in `docs/GENESIS-RAG-TAXONOMY-UAT-REPORT.md`;
- recommendation is `HOLD`: no production activation while approved category count is 0.

### P6 original-product identity review GREEN / promotion HOLD (superseded by P7)

- contract: `docs/GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC.md`;
- `src/rag/catalog-identity.ts` first separated base products, physical variants,
  customization profiles, and source offers; the graph-native P7 contract supersedes
  the earlier base-product grouping as the active review shape;
- color-only SKU differences remain physical variants; supported customer branding
  remains customization; bundle component signatures remain separate products;
- targeted identity fixtures: 5 passed, 0 failed;
- historical P6 evidence remains in the v0.1.x report lineage;
- active `family_v2` snapshot and taxonomy authority remain unchanged;
- recommendation is `HOLD`: no identity promotion while review-required and
  unclassified records remain unresolved.

### P7 graph-native atomic decomposition GREEN / promotion HOLD

- contract: `docs/GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC.md` v0.2.0b;
- `ProductMaster` is the atomic-product key; `CatalogOffer` is the SKU node;
- set SKU decomposition uses one directed `CONTAINS_COMPONENT` edge per component;
- current snapshot reconciles to 425 atomic products, 1,126 physical variants,
  1,016 offers, 984 set offers, and 3,166 component links;
- status: 43 auto, 327 review_required, 55 unclassified atomic products;
- graph artifact: 2,769 nodes and 10,158 edges;
- reverse lookup uses incoming traversal/index behavior, with no duplicate reverse edge;
- active `family_v2` snapshot and taxonomy authority remain unchanged;
- recommendation is `HOLD`: no identity promotion while owner review remains open.

### P8 owner-logic side-by-side review GREEN / promotion HOLD

- owner-approved contract: `docs/GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC.md`;
- old artifact remains immutable at `data/catalog_identity_review_v1/identity-review.json`;
- new artifact is `data/catalog_identity_review_user_logic_v1/identity-review.json`;
- the owner rule was applied to all 1,016 canonical offers, not only the 55 old unclassified products;
- before/after atomic ProductMaster count is 425 → 427;
- new identity status is 42 auto, 336 review_required, 49 unclassified;
- new type result is 377 classified types, with five owner mappings applied;
- two set offers were removed from ProductMaster identity and decomposed from source descriptions:
  `Happy Valentine's Day Lovers Set` → Coffee Mug + Neck Massage, and
  `Portable Tea Pot Gift Set` → Tea Pot + Tea Cup ×3;
- graph result is 2,770 nodes, 10,155 edges, and 3,170 component links;
- old artifact SHA256 remains `87D473B870C133ABB6EBC4BAC1BC3B6D86FC7887D72BB6FAF3AFC683A985F36B`;
- new artifact replay SHA256 is `CD7ACF8D6B1FA21576AC9A7EA043C8A7EA2A2840AA55799C8F73500A399231E4`;
- targeted owner-logic tests: 5 passed; full suite: 295 passed, 0 failed, 2 skipped because no DuckDB path was configured; typecheck and build passed; active runtime and taxonomy authority unchanged;
- recommendation is `HOLD`: this remains a review-only comparison artifact until owner promotion.

### P9 E5 candidate resolution GREEN / promotion HOLD

- approved contract: `docs/GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-SPEC.md`;
- selected vector run: `RUN1_BMR1_5921CC9447EA_ve_20260823T025634936Z_01` using
  `intfloat/multilingual-e5-small` revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`;
- exact Flat search over 425 ProductMaster vectors produced 3,142 unique candidate pairs;
- deterministic hard-rule resolution produced 0 merge proposals, 47 classified review pairs,
  567 pairs blocked by unclassified evidence, and 2,528 hard-rule separations;
- authoritative and proposed counts are both 425; `autoMergeAllowed=false` and no active graph,
  ProductMaster, SKU, taxonomy, price, quote, or stock data changed;
- seven targeted tests pass, including pair deduplication, color variant, component/physical
  conflict, unclassified, set leakage, semantic review, and deterministic merge grouping;
- replay hashes for candidate pairs, resolutions, merge groups, review queue, and metrics are stable;
- recommendation remains `HOLD` until the 47 classified pairs receive owner or gold-label review.

## 3. Changed surfaces

| Path | Change |
|---|---|
| src/rag/taxonomy.ts | New pure parser and P0 rule version taxonomy-p0-v1 |
| tests/unit/genesis-taxonomy.test.ts | Deterministic unit/contract fixtures |
| src/rag/taxonomy-report.ts | Family-level P2 review report builder |
| tests/unit/genesis-taxonomy-report.test.ts | Report counts, provenance, and unresolved-policy fixtures |
| src/rag/taxonomy-projection.ts | Deterministic side-by-side taxonomy graph builder |
| src/rag/taxonomy-projection-store.ts | Snapshot-safe native store lifecycle and manifest writer |
| tests/unit/genesis-taxonomy-projection.test.ts | Projection node/edge/manifest contract fixtures |
| tests/unit/genesis-taxonomy-projection-store.test.ts | Idempotency, drift, and legacy-store lifecycle fixtures |
| scripts/build-taxonomy-projection.ts | Explicit local materialization command |
| package.json | Includes taxonomy tests in npm test |
| docs/GENESIS-RAG-TAXONOMY-CONTRACT.md | Records P0 approval and version 0.1.0 |
| docs/GENESIS-RAG-TAXONOMY-REVIEW-REPORT.md | Aggregate P2 report and approval decisions |
| src/rag/taxonomy-serving.ts | Bounded deterministic P4 preview/query contract and source/manifest gate |
| src/rag/genesis-rag.ts | Awaitable init, taxonomy preview bridge, and projection readiness status |
| src/cli/index.ts | `taxonomy preview` read-only CLI adapter |
| src/mcp/genesis-mcp-server.ts | Shared taxonomy preview tool, readiness, and removal of arbitrary HQL tool |
| tests/unit/genesis-taxonomy-serving.test.ts | Query bounds, counts, exact lookup, review visibility, and drift fixtures |
| docs/GENESIS-RAG-TAXONOMY-SERVING-SPEC.md | P4 contract and non-activation boundary |
| docs/GENESIS-RAG-TAXONOMY-UAT-REPORT.md | P5 UAT, rollback/reference, and activation recommendation |
| .brain/rca/2026-08-23-taxonomy-thai-query-uat-gap.md | Thai query UAT RCA and query-only prevention |
| src/rag/catalog-identity.ts | Deterministic read-only original-product identity review builder |
| tests/unit/catalog-identity.test.ts | Atomic-product, component-edge, reverse-lookup, branding, conflict, size, and material fixtures |
| scripts/build-catalog-identity-review.ts | Local semantic-plus-pricing identity review materializer |
| docs/GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC.md | Approved ProductMaster/SKU/component-edge/variant contract |
| docs/GENESIS-RAG-CATALOG-IDENTITY-REVIEW-REPORT.md | Aggregate atomic-product counts, graph edges, evidence, and promotion HOLD |
| src/rag/catalog-user-logic-review.ts | Side-by-side owner-logic projection, scores, mappings, and set-description decomposition |
| tests/unit/catalog-user-logic-review.test.ts | Owner mapping, set handling, quantity decomposition, graph safety, and replay fixtures |
| scripts/build-catalog-user-logic-review.ts | Separate owner-logic artifact and before/after report materializer |
| docs/GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC.md | Approved side-by-side separation rules, hard rules, weights, and thresholds |
| docs/GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT.md | Generated owner-logic counts, score contract, and comparison evidence |
| src/rag/catalog-embedding-candidate-resolution.ts | Exact vector candidate pairing, hard-rule resolution, and deterministic merge proposals |
| tests/unit/catalog-embedding-candidate-resolution.test.ts | Pair, variant, conflict, set, unclassified, review, and replay fixtures |
| scripts/build-catalog-embedding-candidate-resolution.ts | Checksum-gated E5 sidecar backfill and report materializer |
| docs/GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-SPEC.md | Approved P9 sidecar architecture, scoring, safety, and acceptance gates |
| docs/GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-REPORT.md | Generated run IDs, result counts, review candidates, and artifact checksums |

## 4. Gate status

P1 parser/fixtures: implemented and locally verified.

P2 report/reconciliation preparation: implemented and locally verified.

P2 report and unresolved-row policy: approved by the user on 2026-08-23.
`approvedBaseCategoryCount` remains zero; candidate/review/unclassified assignments
are not authoritative business mappings.

P3 projection contract: approved and implemented at
docs/GENESIS-RAG-TAXONOMY-PROJECTION-SPEC.md. Code and side-by-side store creation
are verified in the isolated taxonomy_v3 store. P4 serving and runtime selection
remain non-authoritative; bounded P4 preview, P5 UAT, P6 identity review, and P7
atomic graph decomposition are implemented and verified. Identity promotion and
production category authority remain gated with a HOLD recommendation.

P8 owner-logic side-by-side review is implemented and locally verified. It writes
only to the new `catalog_identity_review_user_logic_v1` artifact, records formula
weights and row-level comparison evidence, and leaves the old identity artifact
and active runtime unchanged. Promotion remains HOLD.

P9 embedding candidate resolution is implemented and locally verified. It reads the selected
E5 artifacts by checksum and writes only an ignored sidecar directory plus a tracked aggregate
report. The 425 authoritative count remains unchanged; promotion remains HOLD.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.10.0b | 2026-08-23 | beta | Added checksum-gated E5 ProductMaster candidate resolution, deterministic review artifacts, and promotion HOLD evidence | ATHER |
| 0.9.0b | 2026-08-23 | beta | Added P8 owner-logic side-by-side review with explicit scoring, set-description decomposition, and immutable baseline comparison | ATHER |
| 0.8.0b | 2026-08-23 | beta | Added P7 graph-native atomic-product decomposition and canonical one-way component edges | ATHER |
| 0.7.0b | 2026-08-23 | beta | Added P6 original-product identity review evidence, replay verification, and promotion HOLD boundary | ATHER |
| 0.6.1b | 2026-08-23 | beta | Refreshed the final 287-test verification evidence and clarified the P1-P5 scope | ATHER |
| 0.6.0b | 2026-08-23 | beta | Completed P5 read-only UAT, added query-only Thai aliases, and recorded HOLD activation recommendation | ATHER |
| 0.5.0b | 2026-08-23 | beta | Implemented bounded P4 taxonomy preview for CLI/MCP with readiness and no-activation safeguards | ATHER |
| 0.4.0b | 2026-08-23 | beta | Implemented and verified isolated P3 taxonomy_v3 projection; P4 serving remains gated | ATHER |
| 0.3.0b | 2026-08-23 | beta | Recorded P2 approval and drafted the non-activating P3 projection boundary | ATHER |
| 0.2.1b | 2026-08-23 | beta | Added merge-review to taxonomy-status reconciliation matrix and refreshed P2 evidence | ATHER |
| 0.2.0b | 2026-08-23 | beta | Added P2 family-level review report builder, aggregate snapshot evidence, and unresolved-policy gate | ATHER |
| 0.1.0b | 2026-08-23 | beta | Recorded P1 parser implementation, TDD evidence, source replay distribution, and remaining P2 gate | ATHER |
