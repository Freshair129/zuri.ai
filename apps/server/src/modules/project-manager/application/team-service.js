import prisma from '@/lib/db'
import { z } from 'zod'
import { uniqueHumanCode } from '@/lib/ids'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { requireViewer, assertProjectWritable } from './project-authorization'
import { recordAudit } from './audit'

// @req FR-089 — Team as an organisational grouping: create, list, update and
// archive a Team, move a Person in and out of one, and attach a Team to a
// Project. Every write here is audited, because this is the only place that
// writes these three models.
// @spec BR-018, BR-002, SEC-001, SEC-008,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/integration/fr089-team-scope.test.js
// @tested tests/unit/fr089-br018-team-grants-nothing.test.js
//
// **A Team grants nothing** (BR-018, ADR-037 D1). This file writes `Team`,
// `TeamMembership` and `ProjectTeam` and *nothing else* — in particular it never
// creates, updates or deletes a `Membership`, which is the authority record
// `resolveViewer` reads. `addTeamMember` below **requires** a Membership to
// already exist and refuses when it does not; it has no branch that would create
// one. That asymmetry is the whole point: "add someone to a team" must never be
// a privilege escalation with a friendly name, which is exactly what
// `addProjectTeamMember` next door became on 2026-08-17 when a route in front of
// it resolved no viewer and it took `role` from the request body.
//
// **The authorization predicate is imported, never re-implemented.**
// `ownsBusiness` / `seesBusiness` from `identity/viewer-authority` are the only
// predicates in this repository; `requireViewer` and `assertProjectWritable`
// from `project-authorization` are the FR-072 entry points. Nothing below asks
// the authorization question a second way — the ninth diagnosis of a rule
// applied by hand at each site is the reason those live in one place.
//
// **Reads refuse an out-of-scope row; they never filter one out afterwards.**
// Every entry point resolves its target, decides, and throws. A list takes an
// explicit `businessId` and is refused when the viewer cannot see it, rather
// than quietly returning fewer rows — the shape that let
// `GET /api/platform/users` return other tenants' Memberships
// (.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md).

/**
 * A refusal the route layer maps to a status verbatim.
 *
 * `handle()` in `src/app/api/_helpers.js` prefers an explicit `err.status` over
 * its message sniffing, so these survive intact — including the 409 below,
 * whose message contains none of the words that sniffing recognises and would
 * otherwise become a 500.
 */
function refusal(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

// --- Disclosure ------------------------------------------------------------
//
// A Team the viewer may not act on answers with *exactly* the message a missing
// Team produces, so an unowned real Team is indistinguishable from a
// nonexistent one. Anything else turns the refusal into an enumeration oracle
// over other Businesses' team names and codes. Same Tier A decision
// `project-authorization.js` fixes once for every FR-072 caller.
const TEAM_NOT_FOUND = 'Team not found'
const BUSINESS_NOT_FOUND = 'Business not found'

const zCreateTeam = z.object({
  businessId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  code: z.string().min(1).optional(),
})

// `.strict()` on purpose. A Team never changes Business: moving one would carry
// its whole roster into a scope authorized by a different owner, and ADR-037 D2
// says a Team belongs to one Business. Silently dropping a `businessId` a caller
// sent would let them believe the move happened, so the patch is rejected
// instead of quietly narrowed.
const zUpdateTeam = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullish(),
  })
  .strict()

const zListTeams = z.object({ businessId: z.string().min(1) })
const zTeamMember = z.object({ personId: z.string().min(1) })
const zProjectTeam = z.object({ teamId: z.string().min(1) })

/**
 * The Person columns any Team surface may receive.
 *
 * No `email`: a roster renders `displayName · code`, so shipping an address for
 * every member would hand out contact details no surface displays. FR-062 /
 * SDD-035, applied before there is a surface to get it wrong.
 */
const PERSON_FIELDS = { id: true, code: true, displayName: true }

// A Team's Tenant comes from its Business — the model carries no `tenantId` of
// its own, and deriving isolation from a column that is not there is how scope
// checks drift.
const WITH_BUSINESS = { business: { select: { id: true, tenantId: true } } }

async function loadTeam(db, teamId) {
  const team = await db.team.findUnique({ where: { id: teamId }, include: WITH_BUSINESS })
  if (!team || team.deletedAt) throw refusal(404, TEAM_NOT_FOUND)
  return team
}

/**
 * May this viewer CHANGE this Team? Resolves it and refuses, in that order.
 *
 * @spec FR-072 pattern — the write is refused unless the viewer owns the
 * governing Business. `ownsBusiness`, never `role === 'OWNER'` and never
 * `visibleBusinessIds`: those compose into a check that passes for an OWNER of
 * some *other* Business
 * (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).
 */
async function loadTeamForWrite(db, teamId, viewer) {
  requireViewer(viewer, 'team-service write')
  const team = await loadTeam(db, teamId)
  if (!ownsBusiness(viewer, team.businessId)) throw refusal(404, TEAM_NOT_FOUND)
  return team
}

/**
 * May this viewer SEE this Team? Strictly weaker than the write check and never
 * a substitute for it — which is why every read below still reports
 * `manageable` from `ownsBusiness`, the same field the write authorizes on. A
 * list that shows rows whose save can only 404 is the surface half of the
 * 2026-08-17 read-scope incident.
 */
async function loadTeamForRead(db, teamId, viewer) {
  requireViewer(viewer, 'team-service read')
  const team = await loadTeam(db, teamId)
  if (!seesBusiness(viewer, team.businessId)) throw refusal(404, TEAM_NOT_FOUND)
  return team
}

/**
 * The Memberships that put a Person inside this Team's Business.
 *
 * The `businessId: null` branch is tenant-wide Membership, and it is safe here
 * only because it is conjoined with an explicit `tenantId` taken from the Team's
 * own Business. The FR-062 leak was an **unconditional** null branch: a nullable
 * foreign key means "belongs to a wider scope", so including it requires naming
 * that wider scope, which this does.
 */
function membershipScopeForTeam(team) {
  return {
    tenantId: team.business.tenantId,
    OR: [{ businessId: team.businessId }, { businessId: null }],
  }
}

/**
 * Create a Team inside a Business the viewer owns.
 *
 * @spec BR-002 — the human `code` is generated here, never taken from an
 * external system and never used as the primary key.
 */
export async function createTeam(input, { db = prisma, viewer } = {}) {
  requireViewer(viewer, 'createTeam')
  const data = zCreateTeam.parse(input)
  // Same answer an unknown Business would give: naming which Businesses exist
  // is not this endpoint's job.
  if (!ownsBusiness(viewer, data.businessId)) throw refusal(404, BUSINESS_NOT_FOUND)

  const codeExists = async (code) => Boolean(await db.team.findUnique({ where: { code } }))
  const code = data.code || (await uniqueHumanCode('TEAM', data.name, codeExists))
  const team = await db.team.create({
    data: {
      code,
      businessId: data.businessId,
      name: data.name,
      description: data.description ?? null,
    },
  })
  await recordAudit(db, {
    entityType: 'TEAM',
    entityId: team.id,
    action: 'CREATED',
    payload: { code, businessId: data.businessId, name: data.name },
  })
  return team
}

/**
 * Teams inside one Business the viewer can see.
 *
 * `businessId` is required. An "all the teams I can see" list would have to pick
 * a scope for the caller, and the only honest scope — every visible Business —
 * is a cross-Business read nothing has asked for. Refusing an unseen Business
 * outright also keeps the answer the same shape whether the Business is
 * invisible or absent.
 */
export async function listTeams(input, { db = prisma, viewer } = {}) {
  requireViewer(viewer, 'listTeams')
  const { businessId } = zListTeams.parse(input || {})
  if (!seesBusiness(viewer, businessId)) throw refusal(404, BUSINESS_NOT_FOUND)

  const manageable = ownsBusiness(viewer, businessId)
  const teams = await db.team.findMany({
    where: { businessId, deletedAt: null },
    orderBy: { name: 'asc' },
    include: { _count: { select: { members: true, projects: true } } },
  })
  return teams.map((team) => ({
    id: team.id,
    code: team.code,
    name: team.name,
    description: team.description,
    businessId: team.businessId,
    memberCount: team._count.members,
    projectCount: team._count.projects,
    // Server-decided, never inferred by the surface: the field the write
    // authorizes on, reported next to the row it governs (FR-062).
    manageable,
  }))
}

/** One Team, its roster and the Projects it works — for a Business the viewer can see. */
export async function getTeam(teamId, { db = prisma, viewer } = {}) {
  const team = await loadTeamForRead(db, teamId, viewer)
  const [members, projects] = await Promise.all([
    db.teamMembership.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      include: { person: { select: PERSON_FIELDS } },
    }),
    db.projectTeam.findMany({
      where: { teamId, project: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      include: { project: { select: { id: true, code: true, name: true } } },
    }),
  ])
  return {
    id: team.id,
    code: team.code,
    name: team.name,
    description: team.description,
    businessId: team.businessId,
    manageable: ownsBusiness(viewer, team.businessId),
    members: members.map((row) => ({ id: row.id, personId: row.personId, person: row.person })),
    projects: projects.map((row) => row.project),
  }
}

export async function updateTeam(teamId, patch, { db = prisma, viewer } = {}) {
  const team = await loadTeamForWrite(db, teamId, viewer)
  const data = zUpdateTeam.parse(patch ?? {})
  const updated = await db.team.update({
    where: { id: team.id },
    data: {
      name: data.name ?? team.name,
      description: data.description === undefined ? team.description : data.description,
    },
  })
  await recordAudit(db, { entityType: 'TEAM', entityId: team.id, action: 'UPDATED', payload: data })
  return updated
}

/**
 * Archive a Team.
 *
 * Soft delete, like every other retirable record here: the `TeamMembership` and
 * `ProjectTeam` rows stay so the audit trail still resolves, and every read
 * above filters on `deletedAt`. Nothing is granted by these rows, so nothing is
 * revoked by archiving them either — a Team was never authority to begin with.
 */
export async function archiveTeam(teamId, { db = prisma, viewer } = {}) {
  const team = await loadTeamForWrite(db, teamId, viewer)
  const archived = await db.team.update({ where: { id: team.id }, data: { deletedAt: new Date() } })
  await recordAudit(db, { entityType: 'TEAM', entityId: team.id, action: 'ARCHIVED', payload: { code: team.code } })
  return archived
}

/**
 * Put a Person in a Team.
 *
 * @spec BR-018 — this writes a `TeamMembership` and nothing else. The Person
 * must **already** hold a `Membership` in this Team's Business scope; when they
 * do not the call is refused with the message a missing Person produces, so the
 * endpoint is not an oracle over Person ids in other tenants. There is
 * deliberately no branch that creates the Membership: that branch is the
 * escalation ADR-037 exists to prevent, and its absence is what makes "a Team
 * grants nothing" true rather than intended.
 *
 * There is no `role` argument either (ADR-037 D3, "Let Team carry a role"
 * rejected): a role on a Team is authority on a Team.
 */
export async function addTeamMember(teamId, input, { db = prisma, viewer } = {}) {
  const { personId } = zTeamMember.parse(input)
  const team = await loadTeamForWrite(db, teamId, viewer)

  const membership = await db.membership.findFirst({
    where: { personId, ...membershipScopeForTeam(team) },
  })
  if (!membership) throw refusal(404, 'Person not found')

  const existing = await db.teamMembership.findUnique({ where: { teamId_personId: { teamId: team.id, personId } } })
  if (existing) throw refusal(409, 'Person is already in this Team')

  const row = await db.teamMembership.create({
    data: { teamId: team.id, personId },
    include: { person: { select: PERSON_FIELDS } },
  })
  await recordAudit(db, {
    entityType: 'TEAM',
    entityId: team.id,
    action: 'MEMBER_ADDED',
    payload: { teamMembershipId: row.id, personId },
  })
  return row
}

export async function removeTeamMember(teamId, input, { db = prisma, viewer } = {}) {
  const { personId } = zTeamMember.parse(input)
  const team = await loadTeamForWrite(db, teamId, viewer)

  const existing = await db.teamMembership.findUnique({ where: { teamId_personId: { teamId: team.id, personId } } })
  // Load before deleting: `delete` on a missing row raises P2025 and reaches the
  // route as a 500, which reads as a server fault for what is a plain 404.
  if (!existing) throw refusal(404, 'Team member not found')

  await db.teamMembership.delete({ where: { id: existing.id } })
  await recordAudit(db, {
    entityType: 'TEAM',
    entityId: team.id,
    action: 'MEMBER_REMOVED',
    payload: { teamMembershipId: existing.id, personId },
  })
  return { id: existing.id, teamId: team.id, personId }
}

/**
 * The Business governing a Project, by the same derivation every other service
 * uses: the direct owner is authoritative (FR-043), the Space is the
 * additive-backfill fallback.
 */
function projectBusinessId(project) {
  return project.businessId ?? project.workspace?.businessId ?? null
}

/** Teams attached to a Project, for a viewer who can see the Project's Business. */
export async function listProjectTeams(projectId, { db = prisma, viewer } = {}) {
  requireViewer(viewer, 'listProjectTeams')
  const project = await db.project.findUnique({ where: { id: projectId }, include: { workspace: true } })
  if (!project || project.deletedAt) throw refusal(404, 'Project not found')
  const businessId = projectBusinessId(project)
  if (!seesBusiness(viewer, businessId)) throw refusal(404, 'Project not found')

  const links = await db.projectTeam.findMany({
    where: { projectId, team: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    include: { team: { select: { id: true, code: true, name: true, businessId: true } } },
  })
  const manageable = ownsBusiness(viewer, businessId)
  return { projectId, businessId, manageable, teams: links.map((link) => link.team) }
}

/**
 * Attach a Team to a Project.
 *
 * @spec ADR-037 D3 — many-to-many, so this adds a link and never displaces one.
 *
 * A link touches two governed scopes, so it takes the declared authority over
 * **both**, the same fail-closed composition `linkRepository` applies. The
 * Project is authorized first through the shared FR-072 helper, which also
 * refuses a Project no Business governs at all.
 *
 * The two Businesses must then be the same one. A Team is Business-scoped
 * (ADR-037 D2) precisely because a grouping whose members cannot all see the
 * same Projects is a grouping that cannot act; attaching a Team of Business A to
 * a Project of Business B would manufacture exactly that. The refusal names the
 * mismatch rather than hiding behind a 404, because reaching this line means the
 * caller already owns both Businesses and so learns nothing new.
 */
export async function attachTeamToProject(projectId, input, { db = prisma, viewer } = {}) {
  const { teamId } = zProjectTeam.parse(input)
  const project = await assertProjectWritable(viewer, projectId, { db })
  const team = await loadTeamForWrite(db, teamId, viewer)

  if (team.businessId !== projectBusinessId(project)) {
    throw refusal(
      400,
      `Team "${team.code}" belongs to another Business. A Team is Business-scoped, so it may ` +
        'only be attached to Projects in its own Business.',
    )
  }

  const existing = await db.projectTeam.findUnique({ where: { projectId_teamId: { projectId, teamId } } })
  if (existing) throw refusal(409, 'Team is already attached to this Project')

  const link = await db.projectTeam.create({ data: { projectId, teamId } })
  await recordAudit(db, {
    entityType: 'PROJECT_TEAM',
    entityId: link.id,
    action: 'ATTACHED',
    payload: { projectId, teamId, teamCode: team.code },
  })
  return link
}

export async function detachTeamFromProject(projectId, input, { db = prisma, viewer } = {}) {
  const { teamId } = zProjectTeam.parse(input)
  await assertProjectWritable(viewer, projectId, { db })
  const team = await loadTeamForWrite(db, teamId, viewer)

  const existing = await db.projectTeam.findUnique({ where: { projectId_teamId: { projectId, teamId: team.id } } })
  if (!existing) throw refusal(404, 'Team is not attached to this Project')

  await db.projectTeam.delete({ where: { id: existing.id } })
  await recordAudit(db, {
    entityType: 'PROJECT_TEAM',
    entityId: existing.id,
    action: 'DETACHED',
    payload: { projectId, teamId: team.id, teamCode: team.code },
  })
  return { id: existing.id, projectId, teamId: team.id }
}
