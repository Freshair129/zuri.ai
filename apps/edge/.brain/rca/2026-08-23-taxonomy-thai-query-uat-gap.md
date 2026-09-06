---
id: "RCA-TAXONOMY-THAI-QUERY-UAT-GAP"
version: "0.2.0b"
created_at: "2026-08-23T05:10:00+07:00, ATHER"
last_update: "2026-08-23T05:10:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P5 taxonomy preview Thai query UAT"
  risk: "MEDIUM"
  complexity: "C-2"
  language: "th-TH"
---

# RCA — Thai Taxonomy Query UAT Gap

## Symptom

P5 read-only UAT queries `แก้ว` and `ร่ม` returned zero families from the
current catalog snapshot. The P4 serving contract states that Thai, English,
and exact source-code queries are accepted.

## Evidence

- snapshot: `d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31`;
- `taxonomy_preview --query mug --limit 3 --exclude-review` returned results;
- `taxonomy_preview --query drinkware --limit 3 --exclude-review` returned results;
- `taxonomy_preview --query แก้ว --limit 3` returned `matchedFamilyCount: 0`;
- `taxonomy_preview --query ร่ม --limit 3` returned `matchedFamilyCount: 0`;
- canonical taxonomy rule remains `taxonomy-p0-v1` with English source aliases;
- no projection, source, price, or runtime store was changed by the UAT.

## Root cause

`taxonomy-serving.ts` searches normalized family names, source codes, and
canonical English category IDs. It has no explicit Thai query-alias expansion.
The P0 canonical vocabulary is intentionally English/source-phrase based, so
the serving layer cannot infer Thai terms without an explicit query-only map.

## Why detection escaped earlier

P1/P2/P3 tests covered canonical English aliases, parser collisions, counts,
projection determinism, exact identity, and store lifecycle. P4 unit tests
covered bounded input and English fixture queries, but no Thai query was part
of the UAT set.

## Proposed prevention

Add a versioned, explicit Thai query-alias table used only for retrieval
matching. It must not alter `taxonomy-p0-v1`, family assignments, category
edges, manifest counts, or native-store data. Add Thai golden cases to the
serving suite and keep the query-alias version in the response provenance.

## Resolution boundary

This RCA authorizes investigation and test-first implementation of query-only
aliases under the bounded P5 serving scope. It does not authorize canonical
taxonomy promotion or production activation.

## Resolution evidence

`taxonomy-query-alias-v1` now expands explicit Thai query terms only at the
serving matcher. The serving suite passes 6/6, and the current snapshot returns
bounded results for `แก้ว`, `ร่ม`, and `ปากกา`. Canonical rule, projection
counts, category edges, and active runtime remain unchanged.
