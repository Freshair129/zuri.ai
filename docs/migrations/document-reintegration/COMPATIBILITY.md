# Identity compatibility contract

**Status:** Approved contract elaboration; compatibility lane implemented, integration pending

**Applies to:** source identity lookup, reviewed crosswalks, and trace annotation adaptation

**Authority:** [PROPOSAL.md](PROPOSAL.md), decisions 2–4 and 6

## Identity keys and source history

The canonical identity is the exact pair `{namespace, id}`. Serialized qualified
forms are `ZAI:<id>`, `ZNEXT:<id>`, and `edge::<id>`. `edge` keeps its double-colon
form so Edge identities cannot be mistaken for the ZAI/ZNEXT colon form. A bare ID
is accepted only when it identifies exactly one declaration in the supplied
manifest and revision scope. A collision is an error; callers must supply the
namespace.

Identity declarations are looked up from `registry/document-reintegration/identities.json`.
The declaration's `revision`, `path`, and `blob` remain attached to every result.
If the same qualified ID is declared at more than one revision, lookup requires an
explicit revision or locator selector. No resolver may select the newest declaration
implicitly. A mapping row does not change the source identity or its historical
locator.

## Crosswalk and canonical resolution

`registry/document-reintegration/mappings.json` is evidence about crosswalk rows;
`identities.json` remains authoritative for declarations. Each mapping groups one
qualified ZAI source ID and retains `sourceRevision`, `sourceLocator` (`path`, `blob`,
and `sha256`), `targetRevision`, the complete target list, aggregate disposition,
review state, and a provenance array containing every original CSV row (`path`,
crosswalk `revision`, `blob`, `sha256`, row, `targetId`, and row disposition). The
grouped targets preserve source-to-target cardinality without discarding original
row evidence.

A ZNEXT identity resolves to an existing ZAI canonical identity only by inverting
an explicitly approved one-to-one ZAI→ZNEXT crosswalk pair. The selected ZAI
declaration must match the mapping's `sourceRevision` and `sourceLocator`; the
selected ZNEXT declaration revision must match both `targetRevision` and a crosswalk
provenance revision. Callers must select locators when declarations repeat across
revisions. Inverse many-to-one mappings, splits, merges, unreviewed mappings, empty
targets, and mappings to other namespaces never resolve as aliases. They remain
inspectable mapping evidence and require a separately reviewed selection. Similar
ID text, shared suffixes, filenames, or matching statements are never alias evidence.

The resolver returns both the original source declaration and, when allowed, the
canonical target declaration, together with all matching mapping provenance. It
does not rewrite stored IDs, paths, hashes, revisions, approval text, persisted
bindings, or historical snapshots. No runtime reader may rebind a pinned historical
reference through the current crosswalk.

## Trace annotation adaptation

Trace adaptation is a compatibility projection for the current graph only. An
annotation can contribute current ZAI evidence only when its target is explicitly
qualified as `ZAI:<id>` and resolves to one ZAI declaration. Unqualified references,
ZNEXT provenance, Edge identities, proposal intake entries, and unresolved or
ambiguous IDs are excluded and reported as findings. A ZNEXT ID that has an approved
alias remains provenance; it is not current ZAI implementation or verification
evidence.

The adapter preserves relation meaning: `implements` contributes a current
requirement reference; `specified_by` and `decided_by` retain qualified ZAI
specification identities for the graph to map to its existing specification edges;
`verifies` remains a direct test-to-requirement relation. The adapter does not invent
a `tests` verb or convert `verifies` into `@tested`, which means code-to-test in the
current graph. Existing `@tested` annotations remain handled by the legacy reader.
Unsupported relation verbs and malformed or truncated IDs are rejected rather than
partially parsed. The legacy scanner accepts complete bare three-digit IDs, while
excluding qualified IDs, filenames, and longer IDs such as `FR-042-003`.

## Validation boundary

The compatibility validator checks identity declaration uniqueness at
`{namespace, id, revision}`, source and target locators, mapping endpoint existence,
every row in aggregated provenance, and alias cardinality. It reports all errors
without repairing the manifests. It does not promote document approval or delivery
state, validate product behavior, alter historical verifier interpretation, or infer
missing mappings.

Focused Node tests cover same-ID namespace collisions, revision ambiguity, approved
one-to-one aliases, split/merge and inverse-merge refusal, missing endpoints,
provenance preservation, and trace evidence filtering. The graph integrator wires the
adapter into its graph build only after these tests pass; existing graph/link files
remain owned by that integration lane.
