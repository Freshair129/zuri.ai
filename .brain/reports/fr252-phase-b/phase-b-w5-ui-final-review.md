# Phase B W5 UI final independent review

Date: 2026-09-17 (ICT)
Review mode: bounded static source review; no product edits
Execution status: no Vitest, Playwright, build, server, governance, or production command was run by this review.

## Scope and disposition

The current Forms, View, and picker sources satisfy the previously raised UI
intent-retention, Project isolation, review-before-write, picker, lifecycle,
subject-state, and drawer-suspension requirements at source level. **Static
source disposition: PASS.** The final UI gate remains pending the owner's
browser/test execution; this report makes no browser-pass claim.

## Exact hashes

| File | SHA-256 | State read |
|---|---|---|
| `apps/server/src/modules/project-manager/components/ProjectFeatureForms.jsx` | `413D4CF5B32A483699D2BCFCF7C46F158E4553799CBD15457134EED4D3CF0E87` | B frozen handoff |
| `apps/server/src/modules/project-manager/components/ProjectFeatureView.jsx` | `4F7A0517B0DBC5BFA262DBB060CFB29E4087910F3C1F83641E6A8F7876E80FBA` | root frozen View delta |
| `apps/server/src/modules/project-manager/components/ProjectFeaturePickers.jsx` | `70088CA29F922F06509D232FFC9B83832D224B757F164E66EE70595EC160C2DA` | A picker handoff |
| `apps/server/tests/unit/project-feature-forms.test.js` | `3908D86DAFBDA8B167B4ADD3F0171F0C9B475D11C4A368699644FFBA477AAA6E` | B focused test source |
| `apps/server/tests/unit/project-feature-pickers.test.js` | `D1311D3BDC3F58CB104A770AE1168FC5782A78523BE82361134BE878D4CF754F` | A focused test source |
| `apps/server/tests/e2e/project-feature-mutations.spec.js` | `7B0038CF1648930AB8D19CDC22D9D6A2BDE1308C34A6E611123DB12CA486B078` | final frozen e2e source; not run here |

## Findings and evidence

### Forms — source PASS

- The exact attempt is inserted into the Project-owned pending map before
  dispatch (`ProjectFeatureForms.jsx:573-607`), and a pending attempt prevents
  a second submit for the same intent (`:628-640`). This closes the earlier
  in-flight close/reopen loss path when combined with the Project-keyed owner.
- The persisted pending notice retains operation/body-derived intent details
  (`:514-523`, `:734-740`); reconciliation reuses the original attempt and
  idempotency key (`:642-649`).
- Review confirmation now uses `Confirm save` (`:751-781`). Create's primary
  Domain select is required and carries the typed field mapping (`:858`), so
  blank primary Domain cannot silently reach the mutation.
- Dotted field names and picker ARIA/error linkage are passed through
  `fieldControlProps`; first-field focus and review exit are implemented
  (`:751-771`). Requirement identity edits clear the server-derived subject
  and set `UNAVAILABLE` (`:501-507`, `:1094-1127`).
- Lifecycle filtering remains monotonic, and WorkItem allocation summaries
  expose totals, remainder, and unallocated state before confirmation.

### View — source PASS

- The Project-keyed `<ProjectFeatureForms key={projectId}>` owner is rendered
  across loading, refusal, incomplete, and ready branches
  (`ProjectFeatureView.jsx:647-658`, `:661-687`, `:744-762`). A Project change
  creates a new owner and cannot reuse another Project's pending map.
- `formVisible` gates both the inner action and drawer suspension
  (`:643-658`). Early branches replace detail payloads with masked loading or
  failure objects (`:661-687`), avoiding stale detail exposure.
- The drawer uses `inert`, `aria-hidden`, and removes `aria-modal` while a form
  is active (`:511-527`). Focus timeout cleanup and active guards are present
  (`:447-497`).
- `closeForm` rejects callbacks whose captured Project, Feature, or action no
  longer matches the current context (`:630-634`). Successful matching
  callbacks clear the action before rereading (`:635-641`).

### Pickers — source PASS

- Domain options come from the canonical catalog and keep imported unknown
  values disabled as `UNMAPPED` (`ProjectFeaturePickers.jsx:35-53`, `:114-159`).
- WorkItem rows are validated for UUID, active/non-deleted Workstream, and
  same-Project identity, then deduplicated (`:64-84`).
- Search is a non-form region; Enter prevents bubbling into the enclosing form
  and the search control is a button (`:257-265`, `:272-290`).
- Applied Project identity masks old rows until the new context is committed
  (`:103-108`, `:178-217`, `:267-270`). Generation and request guards reject
  late responses (`:219-255`).

## Non-blocking hardening notes

- `responseItems` currently requires `items` to be an array but treats a
  missing or non-boolean `truncated` field as `false` (`ProjectFeaturePickers.jsx:162-164`,
  `:245-246`). The current server DTO supplies the boolean. If the client is
  required to fail closed on malformed response shapes, require that boolean
  too; this is P2 hardening and does not create an authorization bypass because
  every visible row still passes the same-Project validator.
- Capture inputs use native `required` and parse errors, but do not currently
  pass dotted `name`/ARIA field props. Apply the full field-focus requirement to
  capture only if the owner treats capture's local JSON parse refusal as part of
  the §7.4 field-focus contract; no mutation can be sent on malformed JSON.

## Evidence limits

The source and test files were hashed and inspected read-only. The test hashes
above identify available proofs but are not execution evidence from this
review. Root/worker-reported focused and browser results remain external until
the owner reruns the composed gate against these exact hashes.

## Freeze hash refresh

The final read-only refresh confirms that the source and unit-test hashes above
remain unchanged. The frozen e2e source was updated after the earlier snapshot;
its final SHA-256 is:

`apps/server/tests/e2e/project-feature-mutations.spec.js`
`7B0038CF1648930AB8D19CDC22D9D6A2BDE1308C34A6E611123DB12CA486B078`

Root-reported focused `25/25` and e2e evidence are recorded as external
execution evidence; this independent review does not convert those reports into
a locally run claim.

## Owner-reported final test inventory (external)

The owner reports focused Forms/picker coverage `25/25` and two final browser
artifacts. The W5 mutation e2e source is the frozen hash above and covers the
in-flight close/reopen, unrelated-save intent retention, single-modal/focus,
and picker/relationship paths. The companion W3 aggregate/detail privacy e2e
artifact has SHA-256
`C16C58B630D4259056E140688CC2292A88FDB48C98CCAFEEE10B51AAF82E5FF2`.
These are owner-supplied execution/inventory claims, separate from this
review's source-level PASS; no browser command was run by this reviewer.
