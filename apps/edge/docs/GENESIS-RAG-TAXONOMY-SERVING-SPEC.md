---
id: "GENESIS-RAG-TAXONOMY-SERVING-SPEC"
version: "0.2.0b"
created_at: "2026-08-23T04:58:00+07:00, ATHER"
last_update: "2026-08-23T05:10:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P4 read-only taxonomy serving and retrieval preview"
  parent: "GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN"
  projection: "taxonomy-v3-projection-v1"
  query_aliases: "taxonomy-query-alias-v1"
  p3_approval: "approved by user, 2026-08-23"
  p4_execution: "approved by user command, 2026-08-23"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Taxonomy — P4 Serving Specification

## 0. Boundary

P4 adds a bounded, read-only `taxonomy_preview` contract for inspecting the
proposed taxonomy projection. It does not activate `taxonomy_v3`, change the
active `family_v2` runtime, build vectors, change pricing/quote authority, or
send delivery requests.

The projection remains `status: proposed`, `activated: false`, and
`promotionPolicy: visible_no_promotion`. `CANDIDATE_CATEGORY` is evidence for
review only. No query in this contract may treat it as an approved category
mapping.

## 1. Exposed surfaces

| Surface | Contract | Rule |
|---|---|---|
| Pure service | `taxonomy-serving-v1` + `taxonomy-query-alias-v1` | deterministic input/output; no native mutation |
| CLI | `zuri-agent taxonomy preview` | emits the standard CLI JSON envelope |
| MCP | `taxonomy_preview` | same result shape as the CLI service |
| Existing `search_catalog` | unchanged v2 family search | no implicit category filter or v3 selection |
| `execute_hql` | removed | arbitrary HQL is not a registered retrieval contract |

The preview reader validates the v3 manifest against the canonical catalog
snapshot and derived projection counts before returning data. Missing,
incompatible, or drifted projection evidence returns `unavailable`; it does
not fall back to arbitrary HQL or silently select the v2 store.

## 2. Query contract

```json
{
  "query": "optional Thai, English, or exact source code",
  "categoryId": "optional P0 category id, for example drinkware",
  "limit": 5,
  "includeReview": true
}
```

Rules:

- at least one of `query` or `categoryId` is required;
- `limit` is an integer from 1 through 50, default `5`;
- `includeReview` defaults to `true` for review visibility; `false` returns
  only `auto` assignments;
- an exact source code match is ranked before text matches and retains its
  canonical `offerId`, `variantId`, source code, and source provenance;
- explicit Thai terms such as `แก้ว`, `ร่ม`, and `ปากกา` may expand to a
  category for query matching through `taxonomy-query-alias-v1`; this is
  retrieval-only and never creates a canonical assignment;
- `categoryId` filters candidate taxonomy evidence only. It is not an
  authoritative category filter, even when `taxonomyStatus` is `auto`;
- unclassified families are returned when no category match is requested and
  `includeReview` is true; they carry no category assignment.

The service rejects arbitrary HQL, SQL, path expressions, and unregistered
query identifiers. Search is bounded to canonical family/name/code fields and
the versioned taxonomy assignment.

## 3. Response contract

Every successful response contains:

```json
{
  "servingVersion": "taxonomy-serving-v1",
  "queryAliasVersion": "taxonomy-query-alias-v1",
  "mode": "preview",
  "authority": "non_authoritative",
  "projectionStatus": "proposed",
  "activated": false,
  "promotionPolicy": "visible_no_promotion",
  "snapshotId": "...",
  "asOf": "...",
  "taxonomyRuleVersion": "taxonomy-p0-v1",
  "reportVersion": "taxonomy-review-v1",
  "projectionVersion": "taxonomy-v3-projection-v1",
  "query": {},
  "projectionCounts": {},
  "matchCounts": {},
  "results": []
}
```

`projectionCounts` keeps candidate categories, approved categories, families,
variants, and offers separate. `matchCounts` additionally reports matched
bundle families and taxonomy/merge status counts before the result limit.
Each result includes family identity, source codes, variants, offers, taxonomy
status, candidate category IDs, component signature, merge status, review
reasons, and source provenance. Prices, inventory, secrets, raw source rows,
and delivery state are not part of this contract.

## 4. Readiness and failure behavior

The reader is ready only when:

1. the canonical catalog can be read;
2. `taxonomy-manifest.json` exists and is the supported projection version;
3. the manifest snapshot matches the canonical catalog;
4. manifest counts and status reconciliation match the deterministic report;
5. the projection is still explicitly non-active.

On failure the CLI/MCP adapter reports a bounded `unavailable` result with an
error code and safe diagnostic. It does not expose a raw native query or
invent a category result.

## 5. Acceptance criteria

- exact offer/code lookup returns the same canonical offer identity and source
  provenance as the catalog snapshot;
- Thai query aliases return bounded candidate evidence without changing the
  canonical taxonomy rule or projection counts;
- category, family, bundle, variant, and offer counts remain separate and
  traceable to the manifest/report;
- category preview never emits or implies `BELONGS_TO_CATEGORY` authority;
- review-required and unclassified rows remain visible under the documented
  preview default;
- the same query is deterministic for the same snapshot and limit;
- CLI and MCP use the same service response shape;
- arbitrary `execute_hql` is not exposed;
- `family_v2`, pricing, delivery, vector state, and runtime defaults remain
  unchanged;
- typecheck, build, targeted tests, and the full suite pass.

## 6. Explicit non-scope

- activation or promotion of any category assignment;
- changing `search_catalog` to consume taxonomy categories by default;
- vector retrieval, LLM ranking, quote calculation, inventory, or LINE send;
- native HQL execution or user-provided SQL;
- replacing the v2 runtime store.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.2.0b | 2026-08-23 | candidate | Added versioned query-only Thai alias expansion with no canonical taxonomy mutation | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Proposed bounded read-only taxonomy preview contract for P4 | ATHER |
