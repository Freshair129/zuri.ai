---
domain: knowledge
feature: FR-114
module: knowledge
source: v2-native
version: "0.1.0b"
status: "implemented"
---

# FR-114 — Canonical normalization that never destroys the raw value

## Intent

FR-114 implements Stage 4 of `DPL-KNOWLEDGE-INGEST-V1` — the `DPS-KI-NORMALIZE`
row of FR-109's catalog — as a pure calculator in the knowledge lane:
`src/modules/knowledge/normalization.js`, function `normalizeValue`.

The specification's objective for Stage 4 is "ทำให้ representation ของข้อมูลมีรูปแบบ
canonical โดยไม่ทำลาย raw value" — canonical form *without destroying* the raw
value. §3.1 states the same thing as a core principle: raw input must never be
overwritten by normalization, and the source must stay reachable from the
canonical form.

Stage 4 is **Tier 1** under [ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
D2, which is why this executes here.

## The pair, not the replacement

`normalizeValue({ value, kind, era })` returns `{ raw, kind, canonical, ... }`.
`raw` is the input unchanged, byte for byte; `canonical` is the comparable form.
There is no call shape that returns a canonical value on its own.

That is the whole design. §3.1's invariant is usually kept by convention — store
the raw column too, remember not to overwrite it — and a convention holds until
someone writes the one line that does not. Returning the pair makes the
invariant structural: a caller that keeps only `canonical` has visibly discarded
half of a return value, rather than quietly failing to add a field. The
`DPS-KI-NORMALIZE` catalog row already asks for "proof the raw value survives";
this is that proof, produced by the shape of the function rather than by an
assertion bolted on afterwards.

`kind` selects the normalizer. `era` is the one hint a caller may supply, and it
exists only for the date case below.

## What is normalized

Six of §9's twelve categories:

| `kind` | Rule |
|---|---|
| `text` | Unicode + whitespace (below) |
| `date` | Thai and Gregorian digits, Buddhist and Gregorian years, to ISO `YYYY-MM-DD` |
| `phone` | Thai national numbers to E.164 |
| `email` | domain lowercased, local part untouched |
| `organization` | `text`, then the legal wrapper stripped lexically |

**Unicode: NFC, then one explicit fold.** `สำ` can be written as SARA AM
(U+0E33) or as NIKHAHIT + SARA AA (U+0E4D U+0E32). The two render identically —
no reader can tell them apart — and they are different strings. **NFC does not
unify them.** Only NFKC does, and NFKC also folds ligatures, full-width forms
and fraction glyphs, which is more than anyone should do to a name. So the
module runs NFC and then folds that one pair by hand. A test proves the
difference is real under NFC *before* the next test proves it is folded; without
the first test, the second would still pass if the fold were deleted and NFC
silently did the work.

**Whitespace: the class is wider than `\s`.** `\s` does not match U+00A0
(non-breaking space), U+200B (zero-width space), U+200C, U+200D or U+FEFF. All
five are invisible. A name carrying one would never equal the same name typed
normally, and nobody looking at the two strings could say why. They are mapped
to a space before the collapse.

**Dates.** Thai digits `๐-๙` are read. A four-digit year at or above 2400 is
Buddhist and is converted without a hint — 2400 BE is 1857 CE, below which a
four-digit year cannot be Buddhist. A two-digit year needs `era`. Field order is
decided only when one field is out of month range.

**Phone.** A leading `0` is the Thai national trunk prefix and is **replaced** by
`+66`, not kept alongside it: `+6608…` is a number that does not exist.
`+66…` and `66…` forms are accepted as written.

**Email.** The domain is lowercased and the local part is left exactly as given.
RFC 5321 makes the local part case-sensitive; folding it is a silent identity
change, and the fact that most mail hosts happen to ignore case does not make
two different addresses one address.

**Organisation name.** Stage 4 owns this rule — `normalizeOrganizationName` is
exported here, and FR-113 (Stage 8) imports it rather than keeping a second
copy. **The order is fixed and stated: normalization runs BEFORE extraction**, so
a mention is stripped once, by one rule, wherever it came from. Two copies would
drift, and then two spellings of one company would stop matching for a reason
nobody could find. The rule stays lexical: it reads only the string in front of
it. The moment it consults a registry or its neighbours it has started
resolving, which is Stage 9's (FR-113, SDD-060).

## What is declined, and why

The other six of §9's twelve — **currency, unit, product code, country/region,
timezone, identifier format** — are not normalized. `normalizeValue` returns
`canonical: null` with an `unsupported` reason.

The reason is not that locale data is missing. It is that the canonical form of
these is **business-configured**: which currency code a tenant writes, which unit
system it reports in, what shape its product codes and internal identifiers take,
which region spelling its contracts use. A convention invented in this module
would not be neutral — it would be wrong in a way that looks authoritative,
because it would arrive in the same `canonical` field as the answers that are
right, with nothing to mark the difference.

Declining is mechanical, not enumerated: any `kind` with no registered
normalizer takes this path, so a category cannot be half-added by accident.

## Refusing to decide

This is SDD-061, and it is the rule the rest of the module is built around.

**An undecidable value returns `canonical: null` plus the reason — never a guess
with a warning beside it.** A warning next to a readable field is a warning
somebody skips: if `canonical` holds a plausible date, a caller will read it,
and no amount of adjacent text stops that. So the caller is left with nothing
else to read, and has to handle the ambiguity because there is no alternative on
the object.

Three cases pin it:

- **`25/8/26`** — 2526 BE or 2026 CE. Forty-three years apart, both plausible
  business dates, and nothing in the string separates them. Returns `ambiguous`.
  A test additionally asserts that neither reading appears anywhere among the
  result's values, so the guess cannot re-enter through a second field.
- **`5/8/69`** — day and month are both twelve or under, so the field order is
  undeclared. The module resolves order only when one field is out of month
  range: `8/25/69` is month-first because 25 cannot be a month.
- **`31/2/2569`** — a date that does not exist. It returns `invalid` and must not
  roll into March; the test asserts `ambiguous` is absent as well, because "this
  date is not real" and "I cannot tell which date this is" are different answers
  to a caller.

**A caller passing `era: 'BE'` gets an answer.** That is not an inconsistency: at
that point something *outside* the string has decided, and the module is reading
a declared value rather than guessing at an undeclared one. The same is true of
a four-digit Buddhist year, which declares its own era.

## One rule, one owner

`normalizeOrganizationName` has one definition, in this module. FR-113's
`entity-extraction.js` imports it; it does not carry its own copy, and the copy
it used to carry was removed when this requirement landed rather than left to
diverge later.

The dependency direction follows the pipeline: Stage 4 exports, Stage 8 imports,
normalization before extraction. That order is the reason a single rule is
enough — a mention reaching Stage 8 has already been through Stage 4's Unicode
and whitespace handling, so the affix strip is operating on a string whose
invisible characters are already gone.

## Acceptance criteria

Each criterion is checked when a test in
`tests/unit/knowledge-normalization.test.js` proves it (29 tests).

- [x] **AC-114.1** `raw` is the input byte for byte, alongside the canonical form.
- [x] **AC-114.2** `25/8/26` returns `canonical: null` with `ambiguous`, and `raw` intact.
- [x] **AC-114.3** `5/8/69` returns `canonical: null` — day and month are both under thirteen.
- [x] **AC-114.4** For `25/8/26`, neither `2026-08-25` nor `1983-08-25` appears among the result's values.
- [x] **AC-114.5** `8/25/69` is read month-first, because 25 cannot be a month.
- [x] **AC-114.6** `25/8/69` with `era: 'BE'` reads as `2026-08-25` — the specification's own example.
- [x] **AC-114.7** `25/8/2569` reads as `2026-08-25` with no hint; a four-digit Buddhist year declares itself.
- [x] **AC-114.8** An already-canonical `2026-08-25` passes through unchanged.
- [x] **AC-114.9** Thai digits are read: `๒๕/๘/๒๕๖๙` → `2026-08-25`.
- [x] **AC-114.10** `31/2/2569` returns `invalid`, not `ambiguous`, and never rolls into March.
- [x] **AC-114.11** A non-breaking space (U+00A0) collapses to a plain space.
- [x] **AC-114.12** A zero-width space (U+200B) collapses to a plain space.
- [x] **AC-114.13** A tab and a newline collapse to a single plain space.
- [x] **AC-114.14** The two Thai spellings of `สำ` are genuinely unequal, and stay unequal under NFC.
- [x] **AC-114.15** Both spellings nevertheless produce the same canonical form.
- [x] **AC-114.16** Latin combining marks still compose — `Café ABC` survives NFC intact.
- [x] **AC-114.17** `081-234-5678` → `+66812345678`.
- [x] **AC-114.18** `0812345678` → `+66812345678` — the trunk `0` is replaced, not kept.
- [x] **AC-114.19** `+66 81 234 5678` → `+66812345678`.
- [x] **AC-114.20** `02-123-4567` → `+6621234567`.
- [x] **AC-114.21** `1234` returns `canonical: null` with `invalid` — too short to be a number.
- [x] **AC-114.22** `  Foo.Bar@Example.COM ` → `Foo.Bar@example.com`; the local part keeps its case.
- [x] **AC-114.23** An address containing a space returns `canonical: null`.
- [x] **AC-114.24** `บริษัท เอบีซี จำกัด` → `เอบีซี` and `ABC Co., Ltd.` → `ABC` — the rule Stage 8 imports.
- [x] **AC-114.25** `currency` is declined with `unsupported`.
- [x] **AC-114.26** `unit` is declined with `unsupported`.
- [x] **AC-114.27** `product_code` is declined with `unsupported`.
- [x] **AC-114.28** `country` is declined with `unsupported`.
- [x] **AC-114.29** `identifier` is declined with `unsupported`.

`timezone` is the sixth declined category and takes the same default path, but no
test names it; AC-114.25…29 pin five of the six by name.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** The pair is returned to
  the caller and never stored, so the knowledge charter's `owns_models: []` stays
  true. Persisting canonical values alongside raw ones is a later slice and will
  need a charter change.
- **No resolution and no entity matching.** This produces a comparable form; it
  never decides that two comparable forms are one thing. That is Stage 9's, and
  GKS's (§3.4, §14, ADR-050 D2).
- **No business-configured category.** Currency, unit, product code,
  country/region, timezone and identifier format are declined by design, not
  pending. Adding one means deciding whose convention it follows, which is a
  configuration question this module cannot answer.
- **Not a validator.** `invalid` and `ambiguous` describe why no canonical form
  was produced; they are not a validation verdict on the record the value came
  from.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace](./FR-109-knowledge-ingestion-stage-catalog.md) — the `DPS-KI-NORMALIZE` catalog row this implements
- [FR-113 — Entity candidate extraction from chunks and structured records](./FR-113-entity-candidate-extraction.md) — Stage 8, which imports `normalizeOrganizationName` from here
- [FR-112 — Structural knowledge chunking with parent-child lineage](./FR-112-structural-knowledge-chunking.md)
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md)
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md)
- [PRD-SDD v1.0 — FR-114, SDD-061, SDD-060, BR-021](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge ingestion tier boundary and stage ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) — D2 puts Stage 4 in Tier 1
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §9 (Stage 4) is the source requirement; §3.1 is the invariant it makes structural
