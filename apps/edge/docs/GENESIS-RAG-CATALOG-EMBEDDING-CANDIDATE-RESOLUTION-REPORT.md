---
id: "GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-REPORT"
version: "0.1.0b"
created_at: "2026-08-23T17:18:15.105+07:00, ATHER"
last_update: "2026-08-23T17:18:15.105+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P4 E5 ProductMaster candidate resolution sidecar result"
  spec: "GENESIS-RAG-CATALOG-EMBEDDING-CANDIDATE-RESOLUTION-SPEC@0.1.0b"
  risk: "HIGH"
  production_decision: "not_approved"
---

# SmartGift Catalog — Embedding Candidate Resolution P4 Report

## Summary

- authoritative ProductMaster count remains **425**
- proposed ProductMaster count after reviewable consolidation is **425**
- proposed reduction is **0** across **0** groups
- review queue contains **614** candidate pairs:
  **47** classified semantic candidates and
  **567** pairs blocked by unclassified evidence
- no active store, ProductMaster, offer, price, taxonomy or graph authority was changed
- every merge/variant result has `autoMergeAllowed=false`

## Run identity

| Field | Value |
|---|---|
| resolution run | `RESRUN_P4_F6992EEA5821E00E988A` |
| benchmark | `BMR_P4_44FE398EC0C577AC8CB5` |
| dataset revision | `DSR1_5921CC9447EA2EE8B125` |
| vector run | `RUN1_BMR1_5921CC9447EA_ve_20260823T025634936Z_01` |
| model | `MODEL1_HF_intfloat_multilingual_e5_small_614241f622f5` |
| model revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| embedding space | `SPACE1_MODEL1_HF_in_384_cosine_l2` |
| index | `INDEX1_SPACE1_MODEL1_HF_in__40233A471F37_flat_exact` |
| started / ended | `2026-08-23T10:18:14.210Z` / `2026-08-23T10:18:15.105Z` |
| baseline identity SHA-256 | `87D473B870C133ABB6EBC4BAC1BC3B6D86FC7887D72BB6FAF3AFC683A985F36B` |
| owner logic SHA-256 | `CD7ACF8D6B1FA21576AC9A7EA043C8A7EA2A2840AA55799C8F73500A399231E4` |

## Decision counts

| Decision | Count |
|---|---:|
| same_product | 0 |
| variant_of | 0 |
| kept_separate | 2528 |
| review_required | 47 |
| unclassified | 567 |
| hard-rule rejection | 2528 |

## Proposed consolidation groups

| Group | Products | Product IDs | Evidence decision |
|---|---:|---|---|
| — | 0 | — | — |

These are review proposals, not authoritative merges.

## Highest-priority review candidates

| Pair | Left | Right | Cosine | Identity score | Decision |
|---|---|---|---:|---:|---|
| `PAIR_RES_CC16960F72BC65010FAF` | Wireless Charging Power Bank Notebook With Writing Screen Notepad | Wireless Charging Power Bank Notebook With Writing Screen Notepad And Calculator | 0.9884 | 92.02 | `review_required` |
| `PAIR_RES_5E63880B68B27E00AC60` | Wireless Charging Power Bank Notebook With Writing Screen Notepad | Wireless Charging Power Bank Notebook With Writing Screen Notepad And Calculator | 0.9884 | 92.02 | `review_required` |
| `PAIR_RES_F44EFDF4C2A4A7DF1704` | Plate Plain Notebook With Pen | Plate Plain Notebook With Pen Kraft Paper | 0.9753 | 88.25 | `review_required` |
| `PAIR_RES_1B52E18DD20D0A581A3B` | Pour-over Coffee Maker 8 Items Set | Pour-over Coffee Maker 7 Items Set | 0.9943 | 86.78 | `review_required` |
| `PAIR_RES_A98E2C05996227D49983` | Pour-over Coffee Maker 10 Items Set | Pour-over Coffee Maker 7 Items Set | 0.9933 | 86.77 | `review_required` |
| `PAIR_RES_6F235C89F08883B2C9B4` | Pour-over Coffee Maker 7 Items Set | Pour-over Coffee Maker 9 Items Set | 0.9924 | 86.76 | `review_required` |
| `PAIR_RES_C09020EF619820F6495C` | Pour-over Coffee Maker 8 Items Set | Pour-over Coffee Maker 9 Items Set | 0.9923 | 86.76 | `review_required` |
| `PAIR_RES_681E25AD9D5E9C86B382` | Pour-over Coffee Maker 10 Items Set | Pour-over Coffee Maker 9 Items Set | 0.9917 | 86.75 | `review_required` |
| `PAIR_RES_A71711C1551BC92930BB` | Pour-over Coffee Maker 10 Items Set | Pour-over Coffee Maker 8 Items Set | 0.9915 | 86.75 | `review_required` |
| `PAIR_RES_F1369E1407F9E4C5D933` | Vintage Flower Style Thermos Cup | Vintage Flower Style Thermos Cup In Gift | 0.9243 | 86.08 | `review_required` |
| `PAIR_RES_446C24C6B7F2318D9115` | Wireless Charging Light Up Logo Power Bank Notebook | Wireless Charging Power Bank Notebook | 0.9404 | 84.78 | `review_required` |
| `PAIR_RES_6CE7370710821848B279` | Power Bank Notebook | Wireless Charging Power Bank Notebook | 0.9361 | 83.86 | `review_required` |
| `PAIR_RES_4393466FE693850FD5EA` | F6 Basic Model Neck Massager | F6 Neck Massager | 0.9261 | 83.76 | `review_required` |
| `PAIR_RES_C9BAB396E0B328FF3F56` | Wireless Charging Power Bank Notebook | Wireless Charging Power Bank Notebook With Writing Screen Notepad | 0.9627 | 82.57 | `review_required` |
| `PAIR_RES_309622344645B5EAEF25` | Automatic 3 Folding Umbrella | Automatic Triple Fold Umbrella | 0.9904 | 80.90 | `review_required` |
| `PAIR_RES_D779B5FA6BCF5ADACA0C` | Wireless Charging Power Bank Notebook | Wireless Charging Power Bank Notebook With Writing Screen Notepad And Calculator | 0.9606 | 80.61 | `review_required` |
| `PAIR_RES_7F14E6389AEDE7E7B76F` | Power Bank Notebook | Wireless Charging Light Up Logo Power Bank Notebook | 0.9591 | 80.59 | `review_required` |
| `PAIR_RES_EEFF55A5B473DCBAB74B` | Wireless Charging Light Up Logo Power Bank Notebook | Power Bank Notebook | 0.9591 | 80.59 | `review_required` |
| `PAIR_RES_EBBB6CCA491C9B6D9EBE` | Elastic Band Notebook | Loop Notebook | 0.9546 | 80.55 | `review_required` |
| `PAIR_RES_DEC843F7F599BAB848ED` | Elastic Band Notebook | Plate Plain Notebook With Pen Kraft Paper | 0.9522 | 80.52 | `review_required` |

## Artifact hashes

- `candidate-pairs.jsonl`: `6382BACEBBBB2308EA851D8C08F9C225ED34212320E42ED495AADD194A7C2704`
- `resolutions.jsonl`: `5FCADFBED8DD7A43FEDF665AADB2C1854FE204BFEEEDDA9AE9E26D3507DB425E`
- `merge-groups.json`: `D3E8AE6D213FD96B99A63F05FC6C6DF504E1650A4DDB2B071A3BA0430B2A3554`
- `review-queue.jsonl`: `B3E8905541C2930B10E134BC37A5D021F4D8E2AA054BF20AE8DB1487D8A874A7`
- `metrics.json`: `0CFF411F0931B9DB209514AE92E6F821FCB2BE44A94CC518E20DA8ECDB3AAE34`

## Conclusion

P4 makes embedding operational as a deterministic candidate-resolution and review queue.
The production count remains 425. The proposed count
425 may be promoted only after owner review or an
independent gold-label acceptance gate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Generated E5 ProductMaster pair resolution, merge proposals, review queue, metrics, and checksums | pending | ATHER |
