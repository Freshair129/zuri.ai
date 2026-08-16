# A1 audit report — Golden corpus production mapping

## Outcome

The read-only mapping audit is complete, but the A1 activation gate is **BLOCKED**. The current
20-case corpus is still a placeholder: all 14 `ANSWER` cases refer to seven `SG-*` evidence codes
that do not exist in the approved 74-row artifact. The remaining six cases have empty evidence by
design (`FALLBACK` or `DENY_PRIVATE`) and are structurally compatible, but their final Thai wording
and expected policy still require owner approval.

The local operator artifact is internally consistent with its approval and reconciliation
metadata: 74 rows, 74 distinct product codes, no duplicate code, all rows `PUBLIC` and active, all
rows use the one approved source SHA-256, and its byte SHA-256 equals the reconciled export hash.
It contains only useful values for product code, name and category. Price, currency, MOQ,
description and unit are null on every row; colors and specification are empty on every row.
Therefore this artifact cannot support price, MOQ, color or specification golden claims without a
separately approved richer public artifact.

This audit did not query production, use a credential, call a provider, edit the corpus/code, or
inspect PII/financial source tables.

## Complexity, risk and boundary

- Audit complexity: `C-2` — documentation and evidence reconciliation across corpus, evaluator,
  approval manifest and the retained operator artifact.
- Audit mutation risk: `LOW` — read-only local inspection and one report file.
- Downstream activation risk: `HIGH` — A5 must not run until an owner-approved, hash-pinned mapping
  closes A1.
- Binding rule: `A1 -> A5`; `AC-006-02` requires the corpus to map to approved public evidence with
  no PII/financial leakage (`docs/changes/ZV2-CR-006-PHASE1-EXTERNAL-ACTIVATION.md:30-35,51`).

## Authoritative evidence inspected

| Evidence | Exact finding |
|---|---|
| `docs/features/FR-053-phase1-golden-question-evaluation.md:22-33` | Contract requires at least 20 cases, registered queries, evidence codes, numeric allowlists and policy outcomes; the document explicitly calls the corpus placeholder and production mapping/real provider `NOT_RUN`. |
| `contracts/phase1-activation/smartgift-golden-questions.json:4-23` | 20 cases: 14 `ANSWER`, 3 `FALLBACK`, 3 `DENY_PRIVATE`; seven unique placeholder evidence codes and seven numeric allowlist values. |
| `contracts/phase1-activation/golden-questions.schema.json` | Schema permits only `product_search`, `product_detail`, `product_compare`; policy is `ANSWER`, `FALLBACK` or `DENY_PRIVATE`. |
| `contracts/approvals/smartgift-phase1-pilot.json` | One owner-approved source; source SHA-256 `017e72b6748d5f3ad99d2c85da0d3df71cf0e7e3d66fe79e67591066f2788c76`; price publication is false. |
| `docs/roadmap/line-oa-business-agent/PHASE-01-MINIMUM-LINE-KNOWLEDGE.md:94-104` | Approved scope is 74 public code/name/category rows; price/currency disabled; PII and financial fields excluded; export SHA-256 is `63a2d5426838a2fe6e11eb14c370377f28c494e62c6f160d228dc619cf862c5a`. |
| `D:\zuri-ai-supabase-backups\qcnmhyglarzcpudjorzc\20260814-055204\reconciliation.json:3-24` | `READY`, 74 publishable rows, matching export SHA-256, excluded PII tables and excluded financial fields. |
| `D:\zuri-ai-supabase-backups\qcnmhyglarzcpudjorzc\20260814-055204\business-knowledge.jsonl` | Read-only local check: byte hash matches reconciliation; 74 rows/codes; all approved-source/public/active; no duplicate code; no publishable price/MOQ/color/spec/description/unit values. |
| `scripts/evaluate-phase1-golden.mjs:11-42` | Default path reports `NOT_RUN`; `--fake` manufactures records directly from each case's expected codes and model numbers directly from its allowlist. Fake 20/20 is harness proof, not production mapping evidence. |
| `src/modules/agent/golden-evaluation.js:70-71,85-93,116,153-163,192-194` | Corpus forbidden-data guard, deny path, exact evidence-code comparison, numeric-claim check and all-case pass gate are implemented; report remains real-provider `NOT_RUN`. |

## Hash and inventory pins

| Item | Observed value | Audit result |
|---|---|---|
| Corpus byte SHA-256 | `648aaaaa4f0eef6fada2b8ec9b61d3436aedade5f5e2eeee0a6725e351d69ef4` | Current placeholder file only; not owner-approved as production mapping. |
| Corpus evaluator canonical SHA-256 | `f36e622916aa5bb0c8a0ee49afa544eaddb0682ff9aa61456f4d1e91cec6bcf2` | Fake evaluator output; must change when mapping changes. |
| Approved source SHA-256 | `017e72b6748d5f3ad99d2c85da0d3df71cf0e7e3d66fe79e67591066f2788c76` | All 74 retained rows match. |
| Reconciled artifact byte SHA-256 | `63a2d5426838a2fe6e11eb14c370377f28c494e62c6f160d228dc619cf862c5a` | Matches the retained JSONL bytes and reconciliation report. |
| Artifact cardinality | 74 rows / 74 distinct codes / 0 duplicates | Matches approved metadata. |

Approved artifact code inventory (safe public identifiers only):

```text
AF-001, BCH-01, BCH-02, BCH-03, BCH-04, BRW-25, BRW-35, DB-02, DB-03,
DIS-3008, DIS-3012, DIS-3025, DIS-3026, DIS-3113, DIS-3115, DIS-3116,
DIS-3117, DIS-3118, DIS-3119, DIS-3126, DIS-3127, DIS-3190, DIS-3191,
DIS-5012, DIS-5015, DIS-5016, DIS-5017, DIS-5233, DIS-5241, DIS-5243,
DIS-5246, DIS-5247, DIS-5362, DIS-5363, DIS-5364, DIS-5371, DIS-5372,
DIS-5373, DIS-5802, DSH-02, DSH-03, DSH-11, DSH-12, DSH-13, GFK-11,
GFK-12, HYG-09, HYG-13, HYG-23, HYG-24, HYG-32, KH-10, KH-11, KH-12,
KH-13, LO-01, LUG-02, NP-01, PP-01, PP-02, PP-03, PP-04, PP-05, PP-06,
PP-08, PP-09, PP-10, SV-01, TB-02, TB-03, TB-04, TLS-01, TOOL-01, TOOL-02
```

## Exact case mapping matrix

`ABSENT` means no case evidence code occurs in the approved 74-code inventory. `POLICY_ONLY`
means the case intentionally expects no evidence, but still needs owner approval of its final
wording and policy.

| Case | Query / policy | Current expected evidence | Numeric allowlist | Production mapping | Required correction |
|---|---|---|---|---|---|
| GQ-01 | detail / ANSWER | `SG-PEN-001` | `120` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |
| GQ-02 | detail / ANSWER | `SG-BAG-002` | `250` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |
| GQ-03 | detail / ANSWER | `SG-MUG-003` | `180` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |
| GQ-04 | detail / ANSWER | `SG-USB-004` | `32` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |
| GQ-05 | detail / ANSWER | `SG-BOT-005` | `500` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |
| GQ-06 | search / ANSWER | `SG-PEN-001` | empty | ABSENT | Owner supplies exact search wording and complete expected result-code set from the 74-code inventory. |
| GQ-07 | search / ANSWER | `SG-BAG-002` | empty | ABSENT | Owner supplies exact search wording and complete expected result-code set from the 74-code inventory. |
| GQ-08 | search / ANSWER | `SG-MUG-003` | empty | ABSENT | Owner supplies exact search wording and complete expected result-code set from the 74-code inventory. |
| GQ-09 | compare / ANSWER | `SG-PEN-001`, `SG-BAG-002` | `120`, `250` | ABSENT | Owner selects two approved codes; numeric allowlist must be empty for this artifact. |
| GQ-10 | compare / ANSWER | `SG-MUG-003`, `SG-USB-004` | `180`, `32` | ABSENT | Owner selects two approved codes; numeric allowlist must be empty for this artifact. |
| GQ-11 | compare / ANSWER | `SG-BOT-005`, `SG-PEN-001` | `500`, `120` | ABSENT | Owner selects two approved codes; numeric allowlist must be empty for this artifact. |
| GQ-12 | compare / ANSWER | `SG-BAG-002`, `SG-MUG-003` | `250`, `180` | ABSENT | Owner selects two approved codes; numeric allowlist must be empty for this artifact. |
| GQ-13 | search / FALLBACK | empty | empty | POLICY_ONLY | Approve one exact absent code/term that deterministically returns no row. |
| GQ-14 | search / FALLBACK | empty | empty | POLICY_ONLY | Approve a different exact absent code/term; preserve case uniqueness. |
| GQ-15 | search / FALLBACK | empty | empty | POLICY_ONLY | Approve a third exact absent/unsupported request and expected fallback wording. |
| GQ-16 | search / DENY_PRIVATE | empty | empty | POLICY_ONLY | Approve final Thai private-contact denial prompt/policy; no evidence access is allowed. |
| GQ-17 | search / DENY_PRIVATE | empty | empty | POLICY_ONLY | Approve final Thai customer-data denial prompt/policy; no evidence access is allowed. |
| GQ-18 | search / DENY_PRIVATE | empty | empty | POLICY_ONLY | Approve final Thai employee-data denial prompt/policy; no evidence access is allowed. |
| GQ-19 | detail / ANSWER | `SG-BOX-006` | `60` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |
| GQ-20 | detail / ANSWER | `SG-CARD-007` | `10` | ABSENT | Owner selects one approved code; numeric allowlist must be empty for this artifact. |

### Gap totals

- 14/14 `ANSWER` cases have no production evidence mapping.
- 7/7 unique `SG-*` evidence codes are absent from the approved artifact.
- 7/7 non-empty numeric allowlist values are not supportable by this code/name/category-only
  artifact. They must be removed or backed by a new, separately approved public artifact.
- 6/20 policy-only cases need owner approval even though they require no positive evidence rows.
- The approved 74-row artifact cannot satisfy the broader Phase 1 requirement to cover price, MOQ,
  color and specification questions. A1 can close only after the owner either narrows this corpus
  to the actually approved fields or approves a richer artifact and reruns reconciliation.

## Required owner inputs

1. Choose the dataset path: **A — code/name/category-only** (all numeric allowlists empty; no
   price/MOQ/color/spec claims) or **B — richer public artifact** (explicitly approve each added
   field/source, regenerate the artifact/reconciliation, and supply new hashes).
2. For GQ-01..12 and GQ-19..20, approve the exact production code(s) from the 74-code inventory and
   the final Thai question wording. Search cases must name the complete expected result-code set,
   not one illustrative code.
3. For GQ-13..15, approve three unique, deterministic absent/unsupported inputs and the expected
   `FALLBACK` behavior.
4. For GQ-16..18, approve the final Thai denied-private-data prompts and `DENY_PRIVATE` outcome.
5. Approve the final version bump and pin both the final corpus canonical SHA-256 and the artifact
   SHA-256 in the A1 evidence packet. Approval of the source alone is not corpus approval.
6. Confirm that no owner-requested question depends on price, cost, margin, invoice, customer,
   contact or employee data. Financial/private fields remain outside this activation boundary.

Until all six inputs are recorded, do not run A5 with a real provider and do not mutate the LINE
binding.

## Safe local verification commands

These commands are read-only, use no credentials and do not query production:

```powershell
Get-FileHash -Algorithm SHA256 `
  D:\zuri-ai-supabase-backups\qcnmhyglarzcpudjorzc\20260814-055204\business-knowledge.jsonl

$rows = Get-Content `
  D:\zuri-ai-supabase-backups\qcnmhyglarzcpudjorzc\20260814-055204\business-knowledge.jsonl `
  -Encoding utf8 | ForEach-Object { $_ | ConvertFrom-Json }
$rows.Count
($rows.product_code | Sort-Object -Unique).Count
$rows.product_code | Sort-Object

node scripts/evaluate-phase1-golden.mjs
node scripts/evaluate-phase1-golden.mjs --fake
```

The first evaluator command must remain `NOT_RUN`. The `--fake` command should pass 20/20 only as
a deterministic harness check; because it echoes expected codes/numbers from the corpus, it must
not be used as production-mapping evidence.

## Review-ready notes (six points)

1. **Status:** `DONE_WITH_CONCERNS` for this audit; the downstream A1 activation gate is `BLOCKED`.
2. **Output:** `docs/.rwang-tasks/phase1-a1-golden-report.md` only; no corpus/code/provider/production change.
3. **Coverage:** corpus contract, all 20 cases, evaluator behavior, source approval, local artifact, reconciliation and DIG dependency reviewed.
4. **Positive evidence:** retained artifact hash/cardinality/source/public-field checks all match the approved metadata.
5. **Blocking evidence:** 14 positive cases map to zero production codes, and the artifact has no price/MOQ/color/spec values.
6. **Next review:** owner must provide the six inputs above; then a separate approved corpus edit/review can close A1 before A5.

## Independent review

**Review verdict: PASS with one non-blocking WARN.** The report satisfies the A1 read-only brief,
keeps the ADR-019 production-disabled boundary, and supports its `BLOCKED` activation verdict with
the inspected corpus, approval contract, roadmap authority, reconciliation file and retained local
artifact. It does not promote the fake evaluator result to production evidence.

### Independent numerical checks

| Claim | Independent result | Status |
|---|---|---|
| Corpus size and policies | 20 cases = 14 `ANSWER` + 3 `FALLBACK` + 3 `DENY_PRIVATE` | PASS |
| Placeholder evidence inventory | 7 distinct `SG-*` codes; overlap with the 74 approved artifact codes = 0 | PASS |
| Numeric allowlist inventory | 7 distinct non-empty numeric values; none has an approved value field in this artifact | PASS |
| Corpus byte SHA-256 | `648aaaaa4f0eef6fada2b8ec9b61d3436aedade5f5e2eeee0a6725e351d69ef4` | PASS |
| Corpus canonical SHA-256 | `f36e622916aa5bb0c8a0ee49afa544eaddb0682ff9aa61456f4d1e91cec6bcf2` using the evaluator's sorted-key canonicalization | PASS |
| Artifact cardinality | 74 rows, 74 distinct product codes, 0 duplicates | PASS |
| Artifact byte SHA-256 | `63a2d5426838a2fe6e11eb14c370377f28c494e62c6f160d228dc619cf862c5a`, equal to reconciliation `outputSha256` | PASS |
| Artifact classification | 74/74 `PUBLIC`, 74/74 active, one source hash matching the approval contract | PASS |
| Unsupported positive fields | 0 non-null price/currency/MOQ/description/unit; 0 non-empty colors/specification | PASS |

### Blocker review

- **PASS:** `14/14` positive cases lack a production evidence-code mapping, so A1 cannot close.
- **PASS:** fake `20/20` is only harness evidence because the fake ports derive records and numeric
  output from each case's own expectations.
- **PASS:** owner approval of the source artifact does not approve the final corpus wording,
  evidence mapping or policy cases.
- **PASS:** the current 74-row authority explicitly limits publishable business content to
  code/name/category and disables price/currency; the roadmap separately requires the broader
  golden set to cover price, MOQ, color and specification. The report correctly requires either a
  narrowed owner-approved corpus or a separately approved richer artifact.
- **PASS:** `A1 -> A5` remains a hard dependency; no real-provider run or binding mutation is
  authorized by this report.

### Non-blocking warning

- **WARN:** the phrase "contains only useful values for product code, name and category" should be
  interpreted as *answerable business fields*. The JSONL also carries provenance and control
  metadata such as source reference/hash, timestamps, scope and activation flags. This wording
  does not change the mapping counts, privacy boundary or `BLOCKED` verdict.

No remote system, provider credential, secret or production mutation was used in this independent
review. Review evidence is read-only and the author's report body was not altered.
