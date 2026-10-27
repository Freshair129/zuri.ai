---
doc_type: verification-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
source_revision: "40c1b0296693b3f414db9a196c6c243816b8b9da"
---

# Campaign async params: current framework diagnostic

**Classification: compatibility warning/API debt; no current functional defect
demonstrated in the exercised flow. No route correction was made.** This is a
dated assessment, not a requirement, new product contract or lifecycle change.

Installed Next is **15.5.28**. Its dev parameter wrapper copies underlying
parameters onto a Promise, emits a diagnostic when a copied property is read
synchronously, and then returns the stored value. The current default,
non-Cache-Components production wrapper also copies those properties; that is
source inspection, not production testing. The logger creates an `Error` object for the diagnostic, but the
observed message does not mean the route threw an HTTP exception.

Current routes synchronously read `params.id`: Campaign GET/PATCH implements
[ZAI:FR-160 v1](../../docs/features/FEAT-021/requirements/FR-160.md), Strategy
Plan GET/PATCH directly implements [ZAI:FR-159 v1](../../docs/features/FEAT-021/requirements/FR-159.md),
and handoff POST implements [ZAI:FR-158 v1](../../docs/features/FEAT-021/requirements/FR-158.md).
The selected Campaign flow consumes the latter two boundaries. Their existing
identities, Business authorization, revision/hash binding, CAS and audit contract
are unchanged by this assessment.

## Actual reproduction and limits

The [Campaign receipt](campaign-existing-contract.md), committed separately at
`40c1b029`, records 32 service/unit and 2 browser cases passing. Its final server
log contains 25 async-params diagnostics: 15 Campaign, 8 Plan and 2 handoff.
Successful exercised requests returned 200, with browser assertions covering
reads, approval, handoff/binding and persisted closure.

After that commit, a smaller reproduction copied the retained synthetic browser
DB and private generated client into a new owned fixture. It started Next dev on
a new literal loopback port inside its own bounded Windows Job, reused only the
existing synthetic reviewer's fixture credential, logged in, and read one Plan.
The result was **HTTP 200, the selected Plan ID returned correctly, one Plan
async-params warning, and no exception delivered to the HTTP client**.
[Sanitized observation](campaign-async-params-observation.json) records the exact
source/framework hashes and postconditions. No artificial Promise-only route
failure was substituted for installed-framework behavior.

No credential or Membership row was added (2 and 3 respectively, before/after).
One synthetic login Session was added to the copied DB (4 to 5). Marketing data,
the original retained browser DB and both shared Prisma client schemas stayed
unchanged. The two instrumented Node guard records report zero refused network
or ambient-env reads; the owned job ended with zero active processes. No sender,
provider, campaign mutation, main-dev/UAT or production operation ran. The clone,
logs and synthetic Session remain retained, with the server stopped.

The installed framework also has a `__NEXT_CACHE_COMPONENTS` path whose parameter
Promise lacks these copied properties, so synchronous `params.id` can then be
undefined. Current `next.config.js` and the sanitized run do not enable that
path. This is a conditional compatibility failure mode, not merely cosmetic
logging and not a demonstrated defect in the exercised configuration.

Awaiting `params` would remove reliance on this compatibility behavior, but the
present evidence does not justify calling the warning a functional blocker.
Under the selected instruction to correct code only if a real defect was
verified, implementation stops here. A future framework upgrade/strict-mode
change would need its own compatibility tests. This does not qualify production,
native PostgreSQL, every Marketing branch or full FEAT-021/FR-158/159/160 adoption.

Independent GPT-6 Luna Max source/evidence review reached the same bounded
classification and verified the public/private observation, retained reproduction,
source hashes and isolation postconditions. `npm run govern` passed (0 critical,
0 warning, 43 information items; 553 canonical records and 96 document views).
