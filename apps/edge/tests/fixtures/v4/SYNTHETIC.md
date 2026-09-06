---
id: ZEDGE:SYNTHETIC-FIXTURES
version: 0.1.1b
created_at: "2026-09-06T21:00:00+07:00,RWANG,a470a458"
last_update: "2026-09-06T21:00:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: zuri-edge-device
  scope: monorepo-synthetic-fixture-preparation
relations:
  - type: relates_to
    target: ZAI:ADR-062
---

# Synthetic fixture provenance

Approved by Boss in the monorepo snapshot task on 2026-09-06 under
SNAPSHOT-EXECUTION-SPEC 0.1.0b. C-2 / MEDIUM risk. This preparation branch preserves
the original Edge checkout and its history; it does not activate or relocate a runtime.

`scripts/generate-synthetic-fixtures.mjs` generates the fixture set from taxonomy
and authored constants only. No original catalog fields, image paths, customer
identifiers, transcript content or real prices are inputs to the generator.
The [query rubric](../../../scripts/author-nl-queries.md) defines coverage and
evaluation limits. `ZAI:ADR-062` is a qualified external Server reference.

| Fixture | Preserved coverage |
| --- | --- |
| synthetic-50.json | 50 models, 319 variants, 82 offers, 188 component links, 142 price lines, 132 embeddable nodes; attributes, colors, customization and single/set relationships |
| flowaccount-rows.json | 20 rows; bucket counts 10 parsed / 2 name-coded / 1 unparsed / 2 non-giftset / 4 blank / 1 inactive; missing price and code grammar regressions |
| line-chat-turns.json | 17 authored turns; four non-vacuous exclusions, color evidence, greeting routing, five-card cap |
| querysets | 60 natural-language / 6 LINE-style / 1,005 offer query cases, all references synthetic |

Prices exceed the replay budget of 200; higher quantity tiers have lower prices.
The query-set unit tests check graph identity uniqueness, graph edge endpoints,
query model/type references, offer component targets, counts and tier ordering.
Replay runs production graph/search/answer code with a stub model and deterministic
lexical ranking. Native store/real embedding tests retain their existing opt-in gate.
No real model or customer store is authorized for this preparation.

The first authored budget-only positive control did not return drinkware among the
three lexical nearest results. The replay query now names cup/notebook alternatives
before excluding cups, proving both the exclusion and positive control. Assertions
and search implementation are unchanged. See the preparation RCA in `.brain/rca/`.

## Version diff / CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0b | 2026-09-06 | beta | Document approved synthetic fixture preparation and evidence boundaries | a470a458 (base) | RWANG |

Version diff 0.1.0b → 0.1.1b: add the monorepo-qualified document metadata ID;
synthetic data and coverage invariants are unchanged.
