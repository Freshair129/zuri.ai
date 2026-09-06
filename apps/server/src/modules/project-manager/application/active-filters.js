// @req FR-005, FR-007 — one definition of "a workstream that still counts".
// @spec BR-004, SDD-002
// @tested tests/integration/work-listing-scope.test.js
//
// `{ deletedAt: null, status: { not: 'ARCHIVED' } }` was written out by hand in
// four places — three in `progress-service`, one in `scope-service` — and NOT in
// `listWork`. So every progress figure excluded archived workstreams while the
// global Work browser listed their items and offered an inline status editor for
// them. Editing one changed a number nothing displays.
//
// (Finding recorded in .brain/reviews/pm-r2-progress.md — cited in prose, not
// in @spec, because the graph indexes docs/ and not .brain/.)
//
// That is the same defect W3 fixed between the execution cards and their
// calculators: a shared idea, applied to two different populations. A shared
// formula is not agreement — both sides must also agree on what they are
// counting. So the predicate lives here once.
//
// `not: 'ARCHIVED'` is deliberately NOT rewritten as `in: [...active statuses]`.
// They are not equivalent: a row holding a value outside the enum passes `not`
// and fails `in`, so the "tidier" version silently hides rows the original
// showed. That substitution was made once by automation during this review and
// reverted (.brain/rca/2026-08-17-a-guard-that-teaches-a-workaround.md).
//
// Returned from a function rather than exported as a shared object literal:
// Prisma `where` fragments get spread and extended by callers, and a shared
// mutable object is one careless `Object.assign` away from leaking a filter
// between two unrelated queries.

/** A workstream that is neither soft-deleted nor archived. */
export const activeWorkstream = () => ({ deletedAt: null, status: { not: 'ARCHIVED' } })
