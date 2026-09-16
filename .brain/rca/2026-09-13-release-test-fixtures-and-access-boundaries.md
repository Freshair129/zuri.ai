---
version: "1.0.0b"
created_at: "2026-09-13T04:58:00+07:00,RWANG,08d2e778"
last_update: "2026-09-13T04:58:00+07:00,RWANG"
status: beta
attributes:
  domain: identity
  scope: isolated release test fixtures
---

# Release test fixtures and access boundaries

## Symptom

The first full regression run could not bootstrap FR-197's first operator.
The full browser run also failed four older scenarios: password reset target
lookup, two receipt success paths, and payment verification.

## Evidence

- The initial regression run had 5,010 passing tests, with only FR-197 setup
  failing `BOOTSTRAP_REFUSED_OPERATOR_EXISTS`. Superadmin's earlier fixture
  left its standing OPERATOR grants active in the serial suite's shared test DB.
- Scoped teardown of that fixture's own grants made the paired tests pass
  (13 tests), then the full regression pass (5,015 tests, 15 skipped).
- FR-165's Playwright trace on the isolated `localhost:3112` server records
  `POST /api/procurement/purchase-orders/<id>/receipts` returning HTTP 409,
  `GOODS_RECEIPT_SELF_POST_FORBIDDEN`. The test creates/sends the PO and posts
  its receipt through the same owner session. The receipt service and that
  test were unchanged from the base revision before this correction.
- FR-164's receipt trace has the same refusal. FR-166 returns HTTP 409
  `PAYMENT_SELF_VERIFY_FORBIDDEN` when the payment recorder verifies it.
- FR-104 searches `directory.people` for PER-DELIVERY. That seeded person has
  a Membership but no Employment, so the lookup must use `accessMembers`.
  The new HR create-and-refresh browser test passed in this full run.

## Root cause

Two fixture assumptions conflict with current access rules: a global bootstrap
test requires no live operator to precede it, and ADR-079/FR-196 requires a
separate receiver unless a self-verification attestation is explicitly made.
The receipt success test's same-person setup violates the latter rule.
Payment verification has the equivalent conflict. The password-reset fixture
also still equates system membership with Employment, contrary to ADR-078.

## Why the issues escaped detection

Focused Superadmin tests cannot observe a later suite's bootstrap precondition.
The pre-existing receipt test was not updated for the SoD rule, and the current
workflow intentionally runs browser tests on main/nightly rather than PRs.

## Correction and prevention

Withdraw only the Superadmin fixture's own grants after its suite. For FR-165,
sign up a separate buyer using the real auth API, grant that fixture access in
the isolated database, and create/send the PO through the buyer's session.
Keep the browser signed in as the receiving owner. Assert persisted creator and
receiver identities differ. Preserve the production SoD refusal and all existing
receipt assertions. Re-run the full browser suite; no runtime permission or
receipt implementation changes are needed.
Use the same independent actor setup for the second receipt scenario and the
payment verifier. Resolve the password-reset target from the access-member
list. These corrections update fixture assumptions to existing contracts.
