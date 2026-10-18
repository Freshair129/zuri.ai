---
doc_type: change-request
title: Managed binary knowledge parsing and immutable source locations
status: approved
superseded_by: null
version: "0.1.0"
date: "2026-10-18"
risk: HIGH
---

# Managed binary knowledge parsing and immutable source locations

## Approval

The current trusted user mandate authorizes ordinary Zuri roadmap implementation,
technical and product decisions, isolated verification, and publication through
independent gates. The latest direction makes actual backlog delivery the primary
objective. Under that delegation the Sol root approves this bounded TASK-ZAI-048
extension for implementation and review. This is a delegated agent decision;
the user did not author this document or personally attest test results.

Approval covers managed FileAsset admission and deterministic non-OCR PDF, DOCX,
and static HTML parsing through the existing knowledge pipeline. It includes
sanctioned additive issuance of FR-288 and SDD-114, selected against the actual
issued and reserved ID roster. The original FR-115 and SDD-063 rows, identities,
hashes and historical text-only scope stay preserved.

The candidate requires independent Verify and separate Review, applicable
exact-head hosted CI, and ordinary root delivery before acceptance. This design
approval does not prove those results. Production, Supabase, provider activation,
credentials, new grants, OCR/model extraction, system PATH changes, destructive
resets and UAT data changes are excluded.

## Existing evidence and parent impact

At accepted source `297b11d2c7098eee6622030d375ecab03c43f3b1`, TASK-ZAI-046
is done and TASK-ZAI-048 is planned. PR #676 merged the candidate binary parsing
contract; that merge did not accept a parser implementation. Existing raw storage
already accepts bytes, while managed admission and the GenesisRAG17 executor
previously assumed UTF-8 text. ParsedArtifact metadata and durable chunk/mention
offsets provide an existing location for a typed, versioned source map.

FR-115 and SDD-063 document the historical parser. This addition extends that
capability without recasting the old rows as newly approved binary behavior.
ADR-072 gains an explicit subsequent-phase amendment. ADR-050 still owns the
Tier 1 versus GKS boundary; GKS/native publication is independently qualified.

## Bounded design

- Admit only authorized active managed FileAssets through the shared admission
  service. Check original byte length and SHA-256 against the immutable source.
- A persisted binary profile, media type and encoding identify the serialized
  transport. Ordinary text beginning with `data:` remains text. Hash original
  decoded bytes, never the base64 transport string, and store original bytes
  through the existing artifact-storage port.
- Use pinned PDF.js, parse5, yauzl and saxes libraries in a terminable worker.
  No remote URL/resource loading, script execution, OCR or model extraction is
  added. Refuse image-only inputs; report unprocessed image content explicitly.
- Version parser/library/profile/mapping identity. Replays preserve immutable
  raw and parsed identities; a changed profile creates a new parse identity.
- Persist typed page, paragraph, element and table-cell source spans with exact
  parsed-text UTF-16 ranges. Carry them through local lineage, chunks, mentions
  and the proposed Stage 9 handoff. Citation and console reads bind the exact
  retained artifact and recheck current access and withdrawal state.
- Apply 20 MiB input, 500 PDF pages, 100,000 DOCX paragraphs, 25,000 table cells,
  100,000 HTML elements/depth 256, 2,000 ZIP entries, 100 MiB total expansion,
  20:1 expansion ratio, 20 MiB selected XML and 10 MiB normalized-output caps.
  Use a 60-second worker deadline and V8 heap limits. A V8 heap limit is not a
  verified 256 MiB resident-memory or operating-system isolation guarantee.
- Malformed, unsupported, ambiguous or over-limit input yields a stable typed
  refusal; partial parsing cannot become a successful downstream stage.

## Acceptance and remaining qualification

1. Real PDF, DOCX and HTML fixtures pass the actual parser and managed admission
   path with original byte/hash preservation and typed source locations.
2. Bad MIME/profile/base64, hash/size mismatch, unsupported geometry and parser
   failure leave no successful partial parse. The existing text/catalog paths
   remain compatible.
3. Replay, parser identity changes and local restart/citation resolution retain
   exact source versions, offsets, current ACL and withdrawal checks.
4. Separate Verify and Review inspect the composed source, tests and authored
   record migration; all required final-head hosted checks pass before merge.
5. Full native Stage 9 and later service propagation, a complete real 17-stage
   publication/query receipt, browser acceptance for binary surfaces and hard
   resident-memory/egress isolation remain explicitly unverified until their
   actual evidence exists. OCR and production remain outside this extension.

TASK-ZAI-048 is not marked done by this decision, a fixture suite, or a local
parser implementation. Its full roadmap exit criteria retain their own gates.

## Version diff

0 to 0.1.0: approves an additive managed binary parsing candidate under delegated
root authority, preserves historical records, and separates local implementation
from untested native-service, browser, isolation and production acceptance.
