---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "4348cdfde18cc0f49f3be19cc23792a80a95cf55"
---

# Existing Campaign contract: isolated service and browser TEST

The selected existing Campaign suites passed **32/32 service/unit tests** and
**2/2 browser cases** against separate, freshly owned SQLite fixtures at the
source revision above. The final browser cohort used **0 retries, 0 skipped
and 0 flaky cases**. Two earlier browser cohorts failed in private harness
setup/transport; they remain failures, with both cohorts' logs, guard records
and error contexts retained, plus the second cohort's screenshots. This is a
bounded existing-contract receipt, not a claim
that the first browser attempt passed or that every Marketing gate is closed.

Canonical [ZAI:FEAT-021 v1](../../docs/features/FEAT-021/feature.md) remains
**building** and [ZAI:FR-160 v1](../../docs/features/FEAT-021/requirements/FR-160.md)
remains **implementation in progress from approved CR-018**. No product, API,
auth, permission, schema, test assertion or canonical record was changed.
Application source is identical to Compact baseline `4061f511`; this domain
check uses a private Next dev server, not the qualified Compact OCI artifact.

## Selected checks and actual evidence

| Existing suite | Result | What it establishes within this fixture |
|---|---:|---|
| `tests/integration/marketing-campaign.test.js` | 10/10 | Direct-service atomic creation/rollback, immutable brief/revision/CAS, Business access, approved receipt binding and closure |
| `tests/integration/marketing-campaign-execution.test.js` | 9/9 | Direct-service authorized PM projection, receipt/revision identity, damaged/deleted-target refusal and transaction behavior |
| `tests/unit/marketing/marketing-campaign-route.test.js` | 4/4 | Mocked viewer/service delegation and strict request handling; not authenticated HTTP evidence |
| `tests/unit/marketing/marketing-campaign-contract.test.js` | 2/2 | Brief/calendar input and backward-compatible Strategy payload/hash rules |
| `tests/unit/marketing-campaign-ui.test.js` | 7/7 | Executable UI contract helpers and source integration seams; not rendered browser evidence |
| `tests/e2e/marketing-campaigns.spec.js` | 2/2 | Real loopback HTTP/browser create, all detail tabs, reload/back/list/board; then independent review, approval, PM handoff, explicit receipt binding, Plan/Timeline and persisted closure |

Final service/unit execution took **8.11 seconds**; the final browser cohort
took **36.665 seconds**. Both ran serially through the existing zero-test guard:

```text
node scripts/assert-tests-ran.mjs vitest run --config <private-qa>/vitest.campaign.config.mjs
node scripts/assert-tests-ran.mjs playwright test --config <private-qa>/playwright.campaign.config.cjs --fail-on-flaky
```

The wrapper's JSON reports were copied into private retention before another
run could replace its shared proof-cache files. [Sanitized observation](campaign-observation.json)
records source/harness hashes, actual counts and isolation postconditions.
The same unchanged service suites also passed an earlier 32/32 run in 8.34s;
the final fresh DB rerun followed guard changes and captured the final harness.

## Isolation, credentials and process ownership

The normal E2E/global Vitest setup was not invoked. Its primary-checkout port,
DB reset/stale-file sweep and shared-client generation were unsuitable here.
Instead, the installed Prisma generator was explicitly selected with a private
schema/output, and auto-install was disabled. The generated SQLite client was
copied byte-for-byte into each owned cohort; all 20 copied files were checked.
Both pre-existing shared SQLite/PostgreSQL client schema hashes are unchanged.
No native PostgreSQL client, server, migration or runtime qualification is claimed.

Each DB was exclusively created empty from the current Prisma schema's DDL.
The unchanged app seed and browser suite created only synthetic accounts in
that private browser DB: **2 PersonCredential rows and 4 login Sessions**, plus
synthetic memberships used by the existing review case. No real/persistent
service credential, provider connection or live authority was used. The owner
password and session secret were generated for that run and held in process
environment only; no real `.env` was loaded. The server and its processes have
stopped; the synthetic DBs and evidence remain private and retained.

The server bound a fresh dedicated `127.0.0.1` port, with its build/cache outside
the checkout. Sanitized child environments contained no ambient PostgreSQL,
sender or provider configuration. Knowledge runtime activation was disabled.
Private guards cover browser page/API/WebSocket paths, disable service workers
and API redirects, and require the selected origin. Node guards permit only
the literal owned loopback IP/port and refuse other hosts/ports, DNS resolver
queries, UDP sends and ambient environment-file reads. For a permitted literal
IP, supplied lookup callbacks are removed so they cannot redirect the peer.

The final cohort reports **3 guarded contexts, 270 allowed page requests and
20 guarded API calls**, with **0 blocked page/API/WebSocket attempts**, **0
instrumented Node network refusals** and **0 ambient-env read attempts** across
39 Node guard records/processes. Five owned literal-IP lookup callbacks were
discarded. Guard presence/activity is required; an empty report set cannot pass.
This is instrumented-path evidence, not host-wide syscall/network capture.

Next and Playwright each ran inside a separate Windows Job assigned before its
root process resumed, with kill-on-close and bounded timeout handling. Both
final jobs exited normally with **0 stragglers and 0 active processes after
cleanup** (35 server-job and 12 browser-job processes observed over their lives).
A separate timeout probe demonstrated four owned processes before termination
and zero afterward. Only owned processes were stopped; no fixture DB, archive,
backup, Docker resource, main-dev, UAT or production resource was removed.

## Retained failures and remaining gaps

- Two Prisma resolution preflights stopped before client/DB creation. Setting
  Node module search alone did not resolve Prisma's schema-relative package
  lookup. Selecting the installed generator explicitly succeeded without
  installation or shared generation.
- Two Vitest startup attempts ran no tests: the first exposed bundled CJS config
  loading, the second Vite's default localhost lookup. The private config uses
  `createRequire`, an explicit literal host and no HMR; assertions were unchanged.
- Browser cohort 1 failed both context fixtures before Campaign steps because
  its raw options lacked Playwright's subsequently applied base URL. The guard
  now supplies and verifies the same private origin explicitly.
- That first startup also recorded a refused NPM request. A separate no-account,
  no-browser diagnostic captured its stack at Next's dev version advisory.
  The private server disables only that advisory after pinning the installed
  hot-reloader hash, retaining the real installed version and `staleness: unknown`.
  A diagnostic rerun had zero refused requests. No installed framework file changed.
- Browser cohort 2 logged in but failed both scope reads before Campaign
  creation: the guard rejected HTTP Agent lookup callbacks even for the owned
  literal IP. A small owned-server RED/GREEN probe established the cause and
  verified callback removal without broadening the destination allowlist.
  Both failed browser cohorts' process jobs still cleaned up successfully.
- The final server log contains existing Next async-`params` diagnostics for
  `/api/growth/plans/[id]` while requests returned 200. This evidence-only change
  does not fix that route or qualify a future framework upgrade.

Native PostgreSQL concurrency/runtime roles, hosted CI, live advertising/LINE
broadcast, delivery, AI/Team runtime, production/release and full FEAT-021/FR-160
adoption remain outside this receipt. Results metrics still require their own
approved evidence. This report changes no existing owner contract or lifecycle.

Private harness corrections received independent GPT-6 Luna Max review before
the final run. `npm run govern` passed (0 critical, 0 warning, 43 information
items; 553 canonical records and 96 document views). Final independent review
verified the retained results, public/private observation equality, source and
executed-harness hashes, client copies, fixture metadata and scope limits; no
remaining evidence discrepancy was found.
