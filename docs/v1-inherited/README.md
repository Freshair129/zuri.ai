# V1 Inherited Documentation (read-only)

Mirror of `G:/zuri/docs` at commit `0b6d3c3`, imported by
`npm run docs:import-v1` per [ADR-005](../ADR-005-V1-DOCUMENTATION-CORPUS.md).

**Rules**

1. **Never edit anything in this folder.** It is evidence of what V1 says. Write
   corrections in a V2 document that cites the inherited file.
2. **It describes V1 semantics** — "tenant" here means *one shop*. V2's scope chain
   is Portfolio → Tenant (isolation) → Business → Workspace → Project.
3. **Cite its ids with a `V1-` prefix** (`V1-ADR-060`, `V1-FEAT-21`, `V1-CR-007`).
   Filenames keep their original form so comments in lifted V1 code still resolve.
4. **It is evidence, not authority.** V2 documents win on disagreement; V1's code
   wins over V1's docs.
5. **Re-sync before each module cutover** (V1 moves ~213 commits/90 days). Drift is
   visible in `MANIFEST.json` → `sourceCommit`.

Mapping from these ids to V2 requirement ids is filled **per feature at lift time**
in `../replacement/PARITY-INVENTORY.md` — not upfront.
