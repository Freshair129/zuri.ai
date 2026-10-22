# Rebuild package generation

Run from a clean, selected repository revision with an isolated Server dependency installation. Use a fresh absolute output directory for each reviewed version. The commands below execute only the static document builder; its database adapter is replaced by a throwing proxy. They do not run HTTP handlers or apply database migrations.

```powershell
node docs/architecture/blueprint/tools/export-openapi.mjs <absolute-repository> <fresh-output>/contracts
node docs/architecture/blueprint/tools/build-blueprint.mjs <absolute-repository> <fresh-output>
```

[resolutions.json](../resolutions.json) is the single editable profile-rule source. Original canonical records remain the source of each unamended requirement. The builder computes the SRS, record disposition, acceptance obligation index, data dictionary and provenance hashes. Reconciliation prose records rationale/navigation and does not supply a competing operative statement.

Run registry/graph/view generation serially before governance. Independently validate the resulting source hashes, profile selection, schemas, references, portable links and claim limits; retain actual command and review receipts separately in evidence. A FROZEN.json receipt prevents these generators from overwriting a published package. It does not make the local files cryptographically immutable; compare the published file manifest when reading them.

## SWE tailoring

The six-part package is this project's minimum handoff profile: PRD/context; SRS including functional, quality, business and security obligations; architecture; data/interface contracts; UX; and acceptance. Traceability and authority metadata accompany the profile; implementation progress and developer delivery plans do not define its behavior.

[ISO/IEC/IEEE 29148:2018](https://www.iso.org/standard/72089.html) covers requirements engineering processes and information items. [ISO/IEC/IEEE 42010:2022](https://www.iso.org/standard/74393.html) covers architecture descriptions. These sources inform the requirements/architecture separation; neither public description establishes that exactly six filenames are universally mandatory. This is a tailored engineering handoff, with no claim of formal clause-by-clause certification.
