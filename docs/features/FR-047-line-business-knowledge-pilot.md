---
feature: FR-047
module: ai-system
source: v2-native
status: beta
version: "0.1.0b"
created_at: "2026-08-14T02:18:06+07:00,ATHER"
last_update: "2026-08-14T02:18:06+07:00,ATHER"
attributes:
  domain: line-ai
  doc_type: feature-note
  scope: FR-047..050
---

# LINE business-knowledge pilot

## Rationale

The first useful LINE capability is not a unified inbox or long-term agent memory. It is one
read-only answer grounded in business-owned product evidence. Keeping this as a bounded vertical
slice proves demand while preserving the production authority order in ADR-007.

## Decisions

- `FR-047` defines the curated knowledge contract and DuckDB/Supabase adapters.
- `FR-048` isolates provider credentials and wire formats behind `ModelProviderPort`.
- `FR-049` verifies claims against evidence before reply text leaves Zuri.
- `FR-050` gives LINE signature and Reply API ownership to `zuri-cli` only.
- Supabase is the cloud relational read source for this phase. It does not replace
  GenesisBlockDB, GKS, or MSP.
- The public projection excludes PII, cost, margin, invoice and arbitrary SQL by construction.

## Alternatives rejected

- Giving the model direct database access: rejected because it cannot enforce the field/query
  allowlist or prove numeric claims.
- Letting both runtimes reply: rejected because one `replyToken` must have one owner.
- Adding memory/vector search now: rejected because it expands the pilot beyond the approved
  read-only product-knowledge outcome.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved rationale and authority boundary | working-tree | ATHER |
