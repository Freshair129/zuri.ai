import { WORKSPACE_SCOPE_TYPES } from '@/lib/validation/enums'
import { isApiAccessFor, ownsBusiness } from '@/modules/identity/viewer-authority'

// @req FR-065 — the import pipeline authorizes the Workspace it is about to write to.
// @req FR-106 — an Enterprise API access key authorizes the same write, scoped to
// the one Tenant the key is bound to and never wider.
// @spec SDD-037, SEC-001, SEC-002, SEC-006, SEC-008, BR-001
// @tested tests/unit/import-authorization.test.js
//
// The three /api/import/* routes took `workspaceId` from the request body and
// resolved no viewer at all. This module is the one place that decides whether a
// resolved target may be written to, and it is called from the pipeline that
// resolves the target — not from each route handler. Three handlers each holding
// their own copy of a predicate is exactly how the `ownsBusiness` idea came to be
// written out longhand in three services, two of them wrong.
//
// No I/O: the caller resolves the Workspace, this decides.

/**
 * How each Workspace scope type is authorized for a WRITE.
 *
 * Deliberately a lookup rather than a chain of `if`s, and deliberately keyed by
 * scope type: a type with no entry here is REFUSED. Adding a value to
 * `WORKSPACE_SCOPE_TYPES` therefore denies by default until someone declares how
 * it is authorized, which is the opposite of what a hand-written
 * `if (scopeType === 'PORTFOLIO' || scopeType === 'TENANT')` would do — that
 * list silently permits the next value anyone adds.
 */
const AUTHORIZERS = {
  // Import is a write, so it takes the same bar every other write path takes.
  // `ownsBusiness` — not `seesBusiness`, and never `role === 'OWNER'`, which is
  // a per-principal label and has now been mistaken for per-Business authority
  // three separate times.
  //
  // @req FR-106 — an Enterprise API service-account viewer is additionally
  // authorized when the target Business belongs to the key's own Tenant.
  // `businessTenantId` is resolved by the caller from the target Business row
  // itself (plan-import-service resolves it alongside the Workspace), never
  // from anything the request body claims — so a key can never widen the
  // upsert surface beyond the Tenant it names (SEC-001, SEC-006). A session
  // viewer never carries `isApiAccess`, so the clause is inert for every
  // human path.
  BUSINESS: (viewer, workspace) =>
    ownsBusiness(viewer, workspace.businessId)
    || isApiAccessFor(viewer, workspace.businessTenantId),
}

/** The scope types this system currently knows how to authorize an import for. */
export const AUTHORIZABLE_SCOPE_TYPES = Object.keys(AUTHORIZERS)

/**
 * Scope types the vocabulary declares but no authority governs.
 * Derived from the enum, never hand-listed — see the note on AUTHORIZERS.
 */
export const UNGOVERNED_SCOPE_TYPES = WORKSPACE_SCOPE_TYPES.filter(
  (type) => !AUTHORIZABLE_SCOPE_TYPES.includes(type)
)

/**
 * Why a Workspace above Business is refused rather than governed.
 *
 * This is a statement about the system, not about the caller: the answer is the
 * same for every principal. The reason is stated in two tenses on purpose,
 * because the first one has a known expiry date (SDD-037).
 *
 * **Today.** No principal can hold authority above Business at all. Verified
 * rather than assumed — `Membership` is created in exactly two code paths and
 * both bind `businessId`, and the viewer contract exposes only Business-keyed
 * grants (`visibleBusinessIds`, `ownedBusinessIds`, `domainsByBusinessId`). A
 * rule invented for this case would be untestable: no principal could satisfy
 * it, and none could be denied by it.
 *
 * **Once FR-067 ships** (Workspace invitation and scoped membership, design
 * approved 2026-08-17) that premise is false — and the refusal survives on a
 * stronger reason, so nothing here changes. A `WorkspaceMembership` is
 * collaboration scope on the top-level container (keyed by `portfolioId`), and
 * FR-067 AC-067.5 makes Tenant/Business/Space/Project assignment a separate
 * audited mutation requiring the relevant owner authority: holding it confers no
 * write authority over a Space belonging to that Portfolio. AC-067.4 says it
 * from the read side — membership alone returns no hidden Project data, and an
 * import creates Project data.
 *
 * A portfolio-scoped Space also carries no `tenantId` at all (`prisma/seed.js`
 * WS-PLATFORM sets only `portfolioId`) while one Portfolio spans every Tenant
 * beneath it, so authorizing a write there would place one above the BR-001
 * isolation boundary.
 *
 * The message names the missing authority on purpose. A refusal that says what is
 * absent is a signpost to the next requirement; a silent denial is a bug report
 * waiting to be filed. The cost is that it confirms the named Workspace exists
 * and is not Business-scoped — accepted knowingly, because that fact is static,
 * identical for every authenticated caller, and grants nobody anything.
 *
 * The exit is neither FR-067 nor a looser predicate here: it is a Space-level
 * owner authority carried in the viewer contract — the FR-061 shape again —
 * after which `AUTHORIZERS` gains an entry. Never before. Authority must be
 * expressible before anything can check it.
 */
function ungovernedScopeRefusal(workspace) {
  return (
    // Worded to stay true across FR-067. "…does not grant it" holds both while no
    // authority above Business can be held at all, and afterwards, when a
    // WorkspaceMembership can be held and still confers no Space write authority
    // (AC-067.5). A message that needs editing on a future merge is a message
    // that will be wrong for a while first.
    `Import target "${workspace.code}" is a ${workspace.scopeType}-scoped workspace. ` +
    'Import authority is declared at Business scope only — no authority above Business ' +
    'grants it, so this import cannot be authorized for any principal. ' +
    'Choose a Business-scoped workspace.'
  )
}

function unknownScopeRefusal(workspace) {
  return (
    `Import target "${workspace.code}" has an unrecognised scope type ` +
    `"${workspace.scopeType}", so no authority can be established for it.`
  )
}

/**
 * May this viewer import into this Workspace?
 *
 * @param {object} viewer    required — a resolved viewer, never a request body
 * @param {object} workspace required — the already-resolved target
 * @returns {{authorized: true} | {authorized: false, reason: string|null}}
 *
 * `reason === null` means: **answer exactly as you would for a Workspace that is
 * not there.** An unauthorized Business-scoped target must be indistinguishable
 * from a nonexistent one, or the refusal itself becomes an enumeration oracle
 * over other tenants' Workspace ids and codes. `reason` as a string is a refusal
 * that is safe — and useful — to disclose verbatim.
 *
 * Both arguments are REQUIRED and throw when omitted. That is the whole point:
 * the failure mode for wiring up a fourth intake surface without authorization
 * must be a loud crash at wiring time, not a quiet write. Same reasoning that
 * made `classify()` demand its `scope`.
 */
export function authorizeImportTarget(viewer, workspace) {
  if (viewer === undefined || viewer === null) {
    throw new Error(
      'authorizeImportTarget(): viewer is required — an import target is authorized ' +
      'against a resolved viewer, never against the request body that named it'
    )
  }
  if (!workspace || typeof workspace !== 'object') {
    throw new Error(
      'authorizeImportTarget(): workspace is required — resolve the target before authorizing it'
    )
  }

  const authorize = Object.prototype.hasOwnProperty.call(AUTHORIZERS, workspace.scopeType)
    ? AUTHORIZERS[workspace.scopeType]
    : null

  if (!authorize) {
    return {
      authorized: false,
      reason: WORKSPACE_SCOPE_TYPES.includes(workspace.scopeType)
        ? ungovernedScopeRefusal(workspace)
        : unknownScopeRefusal(workspace),
    }
  }

  // Not owned → say nothing a nonexistent Workspace would not have said.
  return authorize(viewer, workspace) ? { authorized: true } : { authorized: false, reason: null }
}
