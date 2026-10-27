---
doc_type: implementation-evidence
status: reviewed
version: "0.1.1"
recorded_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
implementation_base: "d5525db188a2cbf8625cebaf9afcce95c836af14"
---

# Compact Task5 PostgreSQL Marketing intake

The original milestone below is preserved. A later full-range review found an
additional first-policy/Business-tenant P2 beyond its 22-case evidence; see the
[separate correction and current validation](task5-policy-scope-correction.md).
The original milestone alone is not full acceptance of that later schedule.

## Pre-code source reconciliation

The selected Task5 authorizes PostgreSQL parity on new owned disposable Compact
TEST targets. It does not authorize live provisioning, migration, access expansion,
persistent credentials, a real Marketing transfer or production/release action.

At the base above, canonical FR-281–283 and SDD-112 retain their issued planned
lifecycle; SDD-112's historical review-before-coding clause and SQLite transaction
wording are not a claim of PostgreSQL qualification. The approved receiver and
physical design record the prior SQLite implementation review, while retaining
older pending-review text. The issued Supabase PostgreSQL mirror explicitly says
structural QA only, disables runtime, forces RLS with no policies and revokes
report tables from public/API/runtime roles. A URL or a portability artifact does
not override that boundary.

The existing fresh Compact snapshot has generic server runtime CRUD policies but
omits the report custody triggers; it is not Marketing acceptance. Independent
GPT-6 Luna Max design review confirmed the Task5 fresh TEST snapshot extension is
within scope and identified implicit PostgreSQL selection as a blocker. Before
application implementation, the plan and approved physical design now record the
bounded exception, explicit provider selection, native test binding and limits.
The issued migration, existing targets and canonical source rows remain unchanged.

## Reviewed design and acceptance binding

- Require trusted server configuration
  `ZURI_MARKETING_REPORT_DATABASE_PROVIDER=postgresql` and the canonical selected
  PostgreSQL client. Unselected/unknown PostgreSQL remains unavailable; bounded
  SQLite behavior and the legacy DB-only wrapper remain compatible.
- The fresh-only snapshot copies the reviewed custody/audit/native-scope guards,
  forced RLS, fixed-search-path trusted-owner functions and revoked direct execute.
  Runtime Policy/Binding privileges are SELECT/INSERT/UPDATE; ExternalReport is
  SELECT/INSERT only. No report deletion/update, public/API access, runtime owner
  or BYPASSRLS grant. No history migration is replayed.
- Existing PostgreSQL scopes lock Policy before Binding, then re-read credential,
  policy, Business and target authority. Absent policy creation uses a transaction
  advisory lock. Provision, revoke and policy mutation use the same ordering.
  SQLite retains its existing first-write guard and bounded retry behavior.
- After Policy/Binding, lock Business, hinted Plan and Initiative, then re-read
  all authority and target scope. If the Plan changed before its Initiative lock,
  retry the whole transaction. This serializes native rebinds before FK validation.
- Actual independent runtime-role sessions must exercise both race orders,
  duplicates/conflicts, expected-version races, bounded contention and audit/outer
  commit rollback. Receipts escape only after commit. Preserve native rows and
  scope/append-only guards; source/provider integration remains synthetic TEST.

The initial design checkpoint had six absent-resolver failures and one existing
SQLite URL case passed. Tests were narrowed after independent design review to
require explicit PostgreSQL selection and deny implicit aliases, before application
code or SQL/grants changed. Implementation now follows that reviewed boundary.

## Implementation and executed checkpoints

The resolver retains the bounded SQLite cache and DB-only wrapper, selecting the
canonical PostgreSQL client only through the explicit trusted server setting.
The receiver, policy, provision and revoke commands use the shared lock/retry
boundary. Known Prisma provider mismatch refuses before a transaction. Pool wait
plus execution time fit within the remaining five-second retry budget. Receipts
and one-time operator credentials escape only after outer commit.

The fresh snapshot copies issued function/trigger bodies without replaying its
table migration/history or changing its disabled Supabase ACLs. Report privileges
are narrowed; trigger enable/definition joins functions/ACLs in the installed
catalog hash. Disabling a custody trigger becomes drift and is never repaired.
The local fixture uses the current210-model baseline and actual `zuri_web_login`
sessions without owner/BYPASSRLS. Native table rows are hashed before/after intake
and replay using a direct all-native-table snapshot, excluding report/audit rows.

| Check | Actual checkpoint |
|---|---|
| Resolver and shared lock TDD | Initial RED6 resolver/4 lock cases; GREEN after implementation |
| Initial native PostgreSQL | RED2: overbroad report ACL and disable crossing acceptance; GREEN after snapshot/shared locks |
| Baseline function/trigger parser | RED1 then GREEN; exact issued guard-body equivalence and hostile SQL refusals retained |
| Provider mismatch/deadline | Unit/native RED for implicit SQLite protocol on PG; unit RED pool+execution over-budget; fixed before composed run |
| Node package/orchestration/CI selectors | PASS140 tests,0 skips; new Marketing workflow selector and provider-aware preflight recognition first failed then passed |
| Wire/provider/lock consumers | PASS19 tests,0 skips after target-lock regression |
| Current snapshot fresh-installer regression | PASS11 tests,0 skips,256.98s; no existing target or private data selected |
| Initial composed Marketing PostgreSQL | PASS16 tests,0 skips,53.23s; before the additional native scope race was exercised |
| Final composed Marketing PostgreSQL | PASS22 tests,0 skips,50.82s; both native-rebind orders, post-lock reread, trigger drift and every case below executed |
| Legacy SQLite and wire | PASS16 tests,2 explicitly skipped paired-Go cases; source counterpart unselected |
| Current Server build | PASS: final rebuild after generated runtime evidence reconciliation; Next compilation, lint/types,94 static pages and build traces |
| Serial registry → graph → views; `npm run govern` | Final PASS553 canonical records,96 views; strict preflight0 critical/0 warning/43 info; initial route recognition CRITICAL retained |

Independent GPT-6 Luna Max final source review found a first-report/native-rebind
race. A first schedule held the receiver after INSERT and passed all three cases
unchanged because relevant unique-index/FK locks already serialized that ordering.
The stronger schedule held the native UPDATE uncommitted before receiver reads and
INSERT. All three cases then failed: receipt publication could survive Initiative
Business/Plan or Plan Business reassignment. Those failures are retained. Target
row locks plus post-lock reads now cover that schedule; the missing-helper unit
regression also failed before implementation. The corrected code passed all22
cases in the final composed run, with no skips. Final SQLite/wire compatibility
reran16 passes/2 explicit Go skips in13.27s. The reviewer ran no tests; the
integrator resolved the finding through failing-first tests and verification.

The [redacted native observation](task5-postgres-observation.json) is written from
completed-case facts after disconnect and owned cleanup, and binds the actual
TEST database/target/catalog/baseline. It identifies the base plus working patch,
not a production release at that Git revision. No credential or raw body is in
the observation. Refused/focused runs and all first failures stay separate.

The legacy QA runner first failed resolving a client under repository `.local`,
then reproduced11 failures when today's client inserted newer Portfolio columns
into the frozen native database. Its private output now lives under the app's
dependency tree and its client is generated from the issued report-schema commit
`5958b38d2994b453a3d2c1176209b6da6b0aceb6`, matching baseline `d08f08a8` plus the
issued report migration. No shared client or historical baseline is replaced.
This is compatibility of current receiver code with the historical197-model
SQLite fixture, separate from the current210-model PostgreSQL claim. The runner
uses the existing test-proof counter and refuses zero executed tests. Generated
private clients/databases and all first failures remain ignored local evidence.

The dedicated CI workflow now selects Marketing source/route/provider/native-test
changes and runs wire plus actual fresh PostgreSQL tests. It has not executed on
the hosted exact head here. The separate Task3 hosted core job remains a Task7
gate. No CI, Linux-host, complete restore, live Go/Marketing transfer, migration,
production/provider approval or release is inferred from the local checks.

The original milestone's first final governance run retained one CRITICAL: the exact report-principal
recognition still required the old `marketingReportDatabase()` call shape. The
route still has the approved dedicated principal; adding a Person/session viewer
would violate its contract. A narrow lexical helper now recognizes only that
existing path with ordered strict bearer/body parsing, the trusted zero-argument
resolver and selected DB/provider delegation. Neighbor paths and altered imports,
arguments, auth/body/provider sources fail its regression. No viewer baseline debt
or namespace exception was added. Separate independent Luna Max review found no
issue in that helper/callsite/tests, and did not treat it as runtime auth proof.
The later full-range correction review found comment/dead-code spoofing in that
regex approach; the linked correction replaces it with a parsed executable-shape
pin and records the hostile regression and current review result.

Task4's corrected committed delta at `d5525db1` also received a scoped independent
read-back: no remaining issue in version metadata, evidence completion/cleanup or
disposable DB selection. The reviewer did not rerun its tests. That review is not
Task5 runtime acceptance.
