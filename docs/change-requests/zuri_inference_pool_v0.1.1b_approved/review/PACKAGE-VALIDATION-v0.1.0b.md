# Package validation — 2026-09-17

**Result: PASS for package checks only.**

| Check | Result |
|---|---|
| Complete candidate source documents | 12 |
| Rendered metadata validated against inspected Zuri schema | 12 passed |
| Typed relations and wikilinks resolved against packet declarations and explicitly verified baseline identities | 76 passed |
| Local package/renderer checks | 274 passed |
| Actual runtime/hardware acceptance cases | 52 planned; all NOT_RUN |
| Repository `npm run govern` / `npm run verify` | NOT_RUN |
| Numeric IDs approved/reserved/published | NONE |
| GitHub / production writes | NONE |

Validation rendered into a temporary directory with **fixture identifiers**, validated YAML, exact required template headings, unique document identities, phase titles/parents/order, global declarations, reference labels and no unresolved slots. The fixture mapping and rendered output are not shipped as approved repository sources.

The renderer was exercised for unbound/wrong-family/duplicate mappings, existing output, output within the packet or target repository, a colliding ledger ID and malformed ledger JSON. A small synthetic Git repository proved the collision scan leaves target files and Git state unchanged. This is not an assertion that the real repository's current or other branches have been scanned for available new IDs.

Actual source audit was performed through the connected GitHub reads recorded in `SOURCES.json`. A complete local checkout was unavailable; upstream governance, application tests, GPU measurement, network qualification and LINE canaries remain unperformed. Numeric IDs must be allocated/reconciled before integrating the drafts.

Detailed check results: [PACKAGE-VALIDATION.json](PACKAGE-VALIDATION.json).
