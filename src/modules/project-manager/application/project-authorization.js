import { prisma } from '@/lib/db'
import { WORKSPACE_SCOPE_TYPES } from '@/lib/validation/enums'
import { isInstallationOperator, ownsBusiness } from '@/modules/identity/viewer-authority'

// @req FR-072 — mutations behind the route-viewer baseline refuse the write
// unless the viewer owns the governing Business, derived from the target's Space.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/project-authorization.test.js, tests/integration/fr072-file-asset-authorization.test.js
//
// 23 route files exported a mutating verb and resolved no viewer at all: every
// write behind them was one nobody could attribute. 19 are repaid through this
// module; the other four are recorded in `.brain/waves/route-viewer-plan.md`
// §BLOCKED because no declared rule answers who may perform them, and inventing
// an answer is worse than leaving the debt visible.
//
// **The decision lives in exactly one place.** `ownsBusiness` in
// `viewer-authority.js` is the only authorization predicate in this repository;
// this module imports it and never re-implements, inlines or approximates it.
// Everything here is either *derivation* — walking a target chain to a
// `businessId` — or *disclosure* — what a refusal is allowed to say. Both are
// fixed here so that no caller, and no future wave, chooses either. The disease
// this repository has now diagnosed nine times is a rule applied by hand at each
// site, correct at the sites someone remembered.
//
// This module keeps its own scope-type lookup rather than reusing
// `import-authorization.js`'s. The two share the one predicate by import; their
// refusal wordings are different disclosure families (FR-065's import-specific
// messages vs the generic FR-072 messages here), and refactoring shipped, tested
// FR-065 code was deliberately out of scope. Consolidating the two five-line
// tables is possible future cleanup, not a defect.

/**
 * A refusal the route layer will map to a status verbatim.
 *
 * `handle()` in `src/app/api/_helpers.js` prefers an explicit `err.status` over
 * its message sniffing, so these statuses survive intact. That matters most for
 * Tier B below, whose message contains the word "cannot" and would otherwise be
 * sniffed into a 400.
 */
function refusal(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * The viewer is a REQUIRED argument, and its absence is a crash — not a 4xx.
 *
 * A plain `Error` with no `.status` reaches `handle()` and becomes a 500,
 * because a missing viewer is a wiring bug in the caller rather than anything
 * the client did. This is the `authorizeImportTarget()` contract restated: the
 * failure mode for wiring up a new surface without authorization must be a loud
 * crash at wiring time, not a quiet write. Every `assert*` below calls this
 * first, so services never call it directly.
 */
export function requireViewer(viewer, context) {
  if (viewer === undefined || viewer === null) {
    throw new Error(
      `${context}: viewer is required — a write is authorized against a resolved ` +
      'viewer, never against the request that named it'
    )
  }
}

/**
 * How each Workspace scope type is authorized for a WRITE.
 *
 * A lookup rather than a chain of `if`s, and keyed by scope type, so a type with
 * no entry here is REFUSED. Adding a value to `WORKSPACE_SCOPE_TYPES` therefore
 * denies by default until someone declares how it is authorized — the opposite
 * of what a hand-written `if (scopeType === 'PORTFOLIO' || …)` would do, since
 * that list silently permits the next value anyone adds.
 */
const AUTHORIZERS = {
  BUSINESS: (viewer, workspace) => ownsBusiness(viewer, workspace.businessId),
}

// --- Disclosure ------------------------------------------------------------
//
// Two tiers, decided once for every caller:
//
// **Tier A — a Business-governed target the viewer does not own** answers with
// 404 and *exactly* the message that target kind's missing-record path already
// produces. An unowned real target must be indistinguishable from a nonexistent
// one, or the refusal itself becomes an enumeration oracle over other tenants'
// ids and codes. This is `import-authorization.js`'s `reason: null` decision,
// expressed as a thrown 404 because these callers throw rather than return.
//
// **Tier B — a target no Business governs at all** answers with 403 and an
// explicit reason naming the missing authority. The messages below knowingly
// confirm that the named target exists and is not Business-governed; accepted for
// the same reason FR-065 accepted it, namely that the fact is static, identical
// for every authenticated caller, grants nobody anything, and shared Spaces are
// visible to every viewer regardless. A refusal that says what is absent is a
// signpost to the next requirement; a silent denial is a bug report waiting to
// be filed.

function ungovernedWorkspaceRefusal(workspace) {
  return (
    `Workspace "${workspace.code}" is a ${workspace.scopeType}-scoped workspace. ` +
    'Write authority is declared at Business scope only — no authority above Business ' +
    'grants it, so this write cannot be authorized for any principal.'
  )
}

function ungovernedProjectRefusal(project, workspace) {
  return (
    `Project "${project.code}" lives in ${workspace.scopeType}-scoped workspace ` +
    `"${workspace.code}", which no Business governs. Write authority is declared at ` +
    'Business scope only, so this write cannot be authorized for any principal.'
  )
}

function unknownScopeRefusal(workspace) {
  return (
    `Workspace "${workspace.code}" has an unrecognised scope type ` +
    `"${workspace.scopeType}", so no authority can be established for it.`
  )
}

/**
 * May this viewer write to this already-resolved Workspace record?
 *
 * Synchronous and record-based: the caller resolves the Workspace, this decides.
 * Callers `await` it anyway so all five entry points below share one call shape.
 *
 * @param {object} viewer    required — throws when absent
 * @param {object} workspace required — a loaded record, never a request body
 * @param {string} [options.notFoundMessage] the Tier A message for this call site
 */
export function assertWorkspaceWritable(viewer, workspace, { notFoundMessage = 'Workspace not found' } = {}) {
  requireViewer(viewer, 'assertWorkspaceWritable')
  if (!workspace || typeof workspace !== 'object') {
    throw new Error(
      'assertWorkspaceWritable(): workspace is required — resolve the target before authorizing it'
    )
  }

  const authorize = Object.prototype.hasOwnProperty.call(AUTHORIZERS, workspace.scopeType)
    ? AUTHORIZERS[workspace.scopeType]
    : null

  if (!authorize) {
    // Tier B. Distinguishing "declared but ungoverned" from "not in the enum at
    // all" costs nothing and tells the next reader which of the two it hit.
    throw refusal(
      403,
      WORKSPACE_SCOPE_TYPES.includes(workspace.scopeType)
        ? ungovernedWorkspaceRefusal(workspace)
        : unknownScopeRefusal(workspace)
    )
  }

  // Tier A. A BUSINESS workspace with a null businessId cannot be created, but
  // if one ever exists `ownsBusiness(viewer, null)` is false for every viewer,
  // so this arm fails closed without a special case.
  if (!authorize(viewer, workspace)) throw refusal(404, notFoundMessage)
}

/**
 * May this viewer write directly to this Business?
 *
 * @req FR-072 — FR-045's FileAsset/mount/reconcile/cache surfaces (
 * `file-asset-service.js`, `file-reconcile-cache-service.js`,
 * `local-file-reveal-service.js`) name a Business as their own target via a
 * `businessId` on the request — not derived through a Project/Workspace chain
 * the way `assertProjectWritable` is. Those six write functions previously
 * gated on `visibleBusinessIds` with a local `assertVisible` helper, which
 * authorizes a MEMBER (or a platform DEV, who owns nothing) to create, relink,
 * reconcile, rebuild-cache or delete FileAssets in a Business they merely see —
 * the same bug class fixed for FR-059, FR-038 and FR-061
 * (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).
 *
 * Same Tier A shape as every other assert* here: an existing-but-unowned
 * Business answers exactly like a nonexistent one, both status 404 with the
 * identical message, so a caller cannot use the response to learn the
 * Business exists.
 */
/**
 * `authorize` defaults to `ownsBusiness` — the universal predicate — but a
 * caller whose domain already grants a broader capability (e.g. asset
 * management's `canWriteAssetIntake`, which also accepts a specific RBAC
 * permission grant) may pass that predicate instead, so this gate agrees with
 * whichever rule already authorized the caller rather than silently
 * re-narrowing it to ownership alone.
 */
export async function assertBusinessWritable(
  viewer,
  businessId,
  { db = prisma, notFoundMessage = 'Business not found', authorize = ownsBusiness } = {}
) {
  requireViewer(viewer, 'assertBusinessWritable')
  const business = businessId ? await db.business.findUnique({ where: { id: businessId } }) : null
  if (!business) throw refusal(404, notFoundMessage)
  if (!authorize(viewer, businessId)) throw refusal(404, notFoundMessage)
  return business
}

/**
 * May this viewer perform an installation-wide operation with no owning
 * Business at all?
 *
 * @req FR-072 — `migrateProjectFiles` (the one-time legacy ProjectFile→FileAsset
 * backfill) previously gated on `['OWNER', 'DEV'].includes(viewer.role)` at the
 * route layer. `role` is a per-principal label, not per-Business authority
 * (the same bug class already repaid for FR-059/FR-038/FR-061), and the
 * operation is global and cross-tenant — every Business's ProjectFile rows,
 * not one the caller owns — so no `businessId` exists to authorize against in
 * the first place. `isInstallationOperator` (FR-075) is the capability
 * actually being asked for, the same one `exportSnapshot`/`importSnapshot`
 * require for the installation-wide backup/restore surface.
 * @spec ADR-016 D10, SEC-001, SEC-008
 * @tested tests/integration/fr072-files-migrate-authorization.test.js
 *
 * Same Tier A disclosure shape as every other assert* here: a non-operator is
 * refused 404, indistinguishable from the route not existing, rather than a
 * 403 that would confirm to an unauthorized caller that the surface exists.
 */
export function assertInstallationOperatorWritable(viewer, { notFoundMessage = 'Not found' } = {}) {
  requireViewer(viewer, 'assertInstallationOperatorWritable')
  if (!isInstallationOperator(viewer)) throw refusal(404, notFoundMessage)
}

/**
 * May this viewer write to this already-resolved FileAsset record?
 *
 * @req FR-072 — the FileAsset-as-target counterpart of `assertBusinessWritable`
 * above, for `relinkFileAsset`, `deleteManagedFileAsset` and `revealFileAsset`,
 * which name the asset itself (via `fileId`) rather than a `businessId`.
 * Record-based like `assertWorkspaceWritable`: each caller already loads the
 * asset for its own business logic (storage kind, relative path, status), so
 * this decides against the record already in hand instead of loading a second
 * copy. The refusal echoes "File asset not found" — the same message an absent
 * `fileId` already produces — so an owned-but-unowned asset is indistinguishable
 * from one that never existed.
 */
export function assertFileAssetWritable(viewer, asset, { notFoundMessage = 'File asset not found', authorize = ownsBusiness } = {}) {
  requireViewer(viewer, 'assertFileAssetWritable')
  if (!asset || typeof asset !== 'object') {
    throw new Error(
      'assertFileAssetWritable(): asset is required — resolve the target before authorizing it'
    )
  }
  if (!authorize(viewer, asset.businessId)) throw refusal(404, notFoundMessage)
}

/**
 * May this viewer write within the Business governing this Project?
 *
 * Returns the loaded Project (with its `workspace`) so callers that need it do
 * not load twice.
 */
export async function assertProjectWritable(
  viewer,
  projectId,
  { db = prisma, notFoundMessage = 'Project not found' } = {}
) {
  requireViewer(viewer, 'assertProjectWritable')

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { workspace: true },
  })
  if (!project || project.deletedAt) throw refusal(404, notFoundMessage)

  // The direct Project owner is authoritative (FR-043); the Space is the
  // additive-backfill fallback, exactly as `project-team-service.js` derives it.
  const businessId = project.businessId ?? project.workspace?.businessId ?? null

  if (businessId === null) {
    // Tier B — FR-072(b). A Project in a PORTFOLIO/TENANT-scoped Space is
    // governed by an authority no principal can hold, so the answer is no for
    // everyone. Refused, with the missing authority named rather than invented.
    throw refusal(403, ungovernedProjectRefusal(project, project.workspace || {}))
  }

  if (!ownsBusiness(viewer, businessId)) throw refusal(404, notFoundMessage)
  return project
}

/**
 * May this viewer write to this Repository?
 *
 * @req FR-073 — a Repository is owned by one Business, so the same predicate
 * that governs every other write governs this one too.
 *
 * Returns the loaded Repository. A Repository whose `businessId` is null is
 * governed by nobody: refused for every principal, with the reason naming what
 * is missing rather than inventing an owner. That is the FR-072(b) shape applied
 * to a row that predates the column.
 */
export async function assertRepositoryWritable(
  viewer,
  repositoryId,
  { db = prisma, notFoundMessage = 'Repository not found' } = {}
) {
  requireViewer(viewer, 'assertRepositoryWritable')

  const repository = await db.repository.findUnique({ where: { id: repositoryId } })
  if (!repository) throw refusal(404, notFoundMessage)

  if (repository.businessId === null || repository.businessId === undefined) {
    throw refusal(403, ungovernedRepositoryRefusal(repository))
  }

  if (!ownsBusiness(viewer, repository.businessId)) throw refusal(404, notFoundMessage)
  return repository
}

function ungovernedRepositoryRefusal(repository) {
  return (
    `Repository "${repository.code}" has no owning Business, so no principal can be ` +
    'authorized to change it. It predates FR-073; run the repository Business backfill ' +
    '(scripts/backfill-repository-business.mjs) to give it an owner.'
  )
}

/**
 * May this viewer write within the Business governing this Workstream's Project?
 *
 * `notFoundMessage` propagates down the whole chain on purpose: a refusal at any
 * depth is then indistinguishable from the target itself being absent, and a
 * dangling `projectId` fails closed with the same 404 rather than authorizing
 * against nothing.
 */
export async function assertWorkstreamWritable(
  viewer,
  workstreamId,
  { db = prisma, notFoundMessage = 'Workstream not found' } = {}
) {
  requireViewer(viewer, 'assertWorkstreamWritable')

  const workstream = await db.workstream.findUnique({ where: { id: workstreamId } })
  if (!workstream || workstream.deletedAt) throw refusal(404, notFoundMessage)

  await assertProjectWritable(viewer, workstream.projectId, { db, notFoundMessage })
  return workstream
}

/**
 * Resolve one dependency endpoint to its governing Project and authorize it.
 *
 * The complete type→chain table lives here rather than in `dependency-service.js`
 * so that the caller wires two calls and derives nothing. Deny-by-default: a
 * type with no entry throws, which keeps a newly added endpoint kind refused
 * until someone declares how it is authorized.
 */
const ENDPOINT_CHAINS = {
  PROJECT: (viewer, id, options) => assertProjectWritable(viewer, id, options),
  WORKSTREAM: (viewer, id, options) => assertWorkstreamWritable(viewer, id, options),
  MILESTONE: (viewer, id, options) => viaProject(viewer, id, options, 'milestone'),
  GATE: (viewer, id, options) => viaProject(viewer, id, options, 'gate'),
  WORK_CONTAINER: (viewer, id, options) => viaWorkstream(viewer, id, options, 'workContainer'),
  WORK_ITEM: (viewer, id, options) => viaWorkstream(viewer, id, options, 'workItem'),
}

async function viaProject(viewer, id, { db, notFoundMessage }, model) {
  const record = await db[model].findUnique({ where: { id } })
  if (!record) throw refusal(404, notFoundMessage)
  return assertProjectWritable(viewer, record.projectId, { db, notFoundMessage })
}

async function viaWorkstream(viewer, id, { db, notFoundMessage }, model) {
  // No `deletedAt` filter, for parity with `assertEndpointExists` in
  // dependency-service.js, which does not filter either. Changing the existence
  // semantics of an endpoint is a separate question from authorizing it.
  const record = await db[model].findUnique({ where: { id } })
  if (!record) throw refusal(404, notFoundMessage)
  return assertWorkstreamWritable(viewer, record.workstreamId, { db, notFoundMessage })
}

export async function assertEndpointWritable(
  viewer,
  { type, id },
  { db = prisma, notFoundMessage = `Dependency endpoint not found: ${type} ${id}` } = {}
) {
  requireViewer(viewer, 'assertEndpointWritable')

  const chain = Object.prototype.hasOwnProperty.call(ENDPOINT_CHAINS, type)
    ? ENDPOINT_CHAINS[type]
    : null
  // Same message and same statusless shape dependency-service.js already uses
  // for an unsupported type — this is a programmer error, not a client one.
  if (!chain) throw new Error(`Unsupported dependency endpoint type: ${type}`)

  return chain(viewer, id, { db, notFoundMessage })
}
