import { handle } from '@/app/api/_helpers'
import { addBusinessMembership } from '@/modules/identity/profile-permission-service'
// @req FR-046 — platform permission identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-038 — the owner of a Business attaches an EXISTING Person to it as an
//   ACTIVE MEMBER with a chosen subset of domain keys. Sibling of the PATCH on
//   `/api/platform/users`, which administers the same rows once they exist;
//   until this route there was no surface anywhere that could create the first
//   Business-level Membership for anybody but the person clicking
//   (D3-identity-onboarding-forms-12). Refusals are the ones the rest of this
//   family already promises: 404-shaped for a Business the caller does not own
//   (indistinguishable from one that does not exist), 409 for a Membership that
//   is already there. It never creates a Person — signup and onboarding own that.
// @spec SDD-017, SEC-001, SEC-003, SEC-008,
//   docs/domains/identity/features/FR-038-profile-and-permissions.md
// @tested tests/integration/fr038-business-membership-add.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const body = await request.json().catch(() => ({}))
    return addBusinessMembership(body, { resolve: () => resolveRequestViewer(request) })
  })
}
