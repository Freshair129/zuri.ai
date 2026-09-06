import { WORKSPACE_INVITE_ROLES } from '@/lib/validation/enums'

// @req FR-067 — the owner half of Workspace collaboration, as a pure view
// model: who may see the panel, what the roster reads as, which request each
// control issues, what a destructive control must confirm first, and how a
// server refusal is put into Thai without ever hiding what the server said.
// The panel itself is JSX in src/app/(entry)/workspace-home/page.jsx; everything
// here is pure so the decisions can be tested without a rendering harness.
// @spec ADR-027 D5/D6/D9 — Workspace administration is an OWNER
// WorkspaceMembership (or Tenant ownership under it, which only the server can
// see). Visibility here is derived from the server's own read model, never from
// a client-held role string, and it is a hint: the service re-checks authority
// on every call and answers a non-owner with the same 404 an absent Workspace
// produces, so a wrong guess here leaks nothing.
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-collaboration-view.test.js

export const WORKSPACE_ROLE_LABELS_TH = {
  OWNER: 'เจ้าของ',
  ADMIN: 'ผู้ดูแล',
  MEMBER: 'สมาชิก',
}

export function workspaceRoleLabel(role) {
  return WORKSPACE_ROLE_LABELS_TH[role] || role || '—'
}

/** Derived from the enum source of truth, so the dropdown can never offer a
 * role the mint boundary refuses — OWNER included (AC-067.6). */
export const MINTABLE_ROLE_OPTIONS = WORKSPACE_INVITE_ROLES.map((value) => ({
  value,
  label: workspaceRoleLabel(value),
}))

export const DEFAULT_INVITE_ROLE = WORKSPACE_INVITE_ROLES.includes('MEMBER')
  ? 'MEMBER'
  : WORKSPACE_INVITE_ROLES[0]

/** Shown beside a freshly minted token: the raw secret is in this response and
 * nowhere else, so a person who navigates away has to mint a new one. */
export const MINTED_TOKEN_NOTICE_TH =
  'รหัสนี้แสดงเพียงครั้งเดียว — คัดลอกและส่งให้ผู้รับตอนนี้ ระบบเก็บไว้เฉพาะค่าที่เข้ารหัสแล้ว หากปิดไปต้องออกรหัสใหม่'

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * The Workspaces this viewer may administer, taken from the read model the page
 * already loaded (`GET /api/onboarding/state`), where `role` is the person's own
 * WorkspaceMembership row as the server reported it.
 *
 * Deliberately the conservative subset: the service also accepts a Tenant owner
 * under the Workspace (`viewer.ownedTenantIds`), which this read model does not
 * expose. Such an owner sees no panel here rather than a panel whose every call
 * might 404 — and the fix, when it is wanted, is to widen the server's read
 * model, not to guess in the client.
 */
export function selectAdministrableWorkspaces(state) {
  const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : []
  return workspaces.filter((w) => w && w.role === 'OWNER' && nonEmpty(w.portfolioId))
}

/** The roster path, or null when there is nothing to read — `useFetch(null)`
 * issues no request, so an unselected Workspace never hits the server. */
export function rosterPath(portfolioId) {
  if (!nonEmpty(portfolioId)) return null
  return `/api/workspace-memberships?portfolioId=${encodeURIComponent(portfolioId.trim())}`
}

function refuse(message) {
  return { error: message, request: null }
}

function issue(request) {
  return { error: null, request }
}

/**
 * The mint request, or the reason it cannot be built. Validation says how to
 * correct the input rather than only that it is wrong (UI-DESIGN-SYSTEM §4).
 */
export function buildMintRequest({ portfolioId, role, invitedEmail } = {}) {
  if (!nonEmpty(portfolioId)) return refuse('เลือก Workspace ที่ต้องการเชิญก่อนออกรหัส')
  const chosen = nonEmpty(role) ? role.trim() : DEFAULT_INVITE_ROLE
  if (!WORKSPACE_INVITE_ROLES.includes(chosen)) {
    return refuse(`บทบาท ${chosen} ออกรหัสเชิญไม่ได้ — เลือก ${MINTABLE_ROLE_OPTIONS.map((o) => o.label).join(' หรือ ')}`)
  }
  const email = typeof invitedEmail === 'string' ? invitedEmail.trim() : ''
  // Optional at the boundary: an invite with no email is handed over directly.
  // Sending an empty string instead of omitting the key fails the route's Zod
  // email check, so a blank field must drop out of the body entirely.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return refuse('รูปแบบอีเมลไม่ถูกต้อง — กรอกเช่น name@example.com หรือเว้นว่างไว้เพื่อส่งรหัสให้ผู้รับเอง')
  }
  return issue({
    path: '/api/workspace-invites',
    method: 'POST',
    body: {
      portfolioId: portfolioId.trim(),
      role: chosen,
      ...(email ? { invitedEmail: email } : {}),
    },
  })
}

export function buildRevokeRequest(inviteId) {
  if (!nonEmpty(inviteId)) return refuse('ไม่พบรหัสอ้างอิงของคำเชิญนี้ — โหลดรายการใหม่อีกครั้ง')
  return issue({
    path: `/api/workspace-invites/${encodeURIComponent(inviteId.trim())}`,
    method: 'DELETE',
  })
}

export function buildRemoveMemberRequest({ portfolioId, personId } = {}) {
  if (!nonEmpty(portfolioId)) return refuse('เลือก Workspace ก่อนนำสมาชิกออก')
  if (!nonEmpty(personId)) return refuse('ไม่พบรหัสอ้างอิงของสมาชิกคนนี้ — โหลดรายการใหม่อีกครั้ง')
  const query = new URLSearchParams({ portfolioId: portfolioId.trim(), personId: personId.trim() })
  return issue({
    path: `/api/workspace-memberships?${query.toString()}`,
    method: 'DELETE',
  })
}

/**
 * The roster as the panel renders it.
 *
 * Removing yourself is the one case blocked in the client: the service allows it
 * (a co-owner handover is a legitimate removal of *another* OWNER, so that stays
 * available), but an owner who removes their own last membership loses the panel
 * that would undo it. Everything else is left to the server.
 */
export function buildRosterView(roster, { viewerPersonId = null, now = Date.now() } = {}) {
  const members = Array.isArray(roster?.members) ? roster.members : []
  const invites = Array.isArray(roster?.pendingInvites) ? roster.pendingInvites : []
  const at = typeof now === 'number' ? now : Date.now()

  return {
    portfolioId: roster?.portfolioId || null,
    memberCount: members.length,
    pendingCount: invites.length,
    members: members.map((member) => {
      // The server marks the session principal (`isSelf`); the id comparison is
      // the fallback for a caller that has one, never the primary answer.
      const isSelf = member.isSelf === true
        || (Boolean(viewerPersonId) && member.personId === viewerPersonId)
      return {
        ...member,
        roleLabel: workspaceRoleLabel(member.role),
        isSelf,
        canRemove: !isSelf,
        removeBlockedReason: isSelf
          ? 'คุณนำตัวเองออกจาก Workspace ไม่ได้ — ให้เจ้าของอีกคนดำเนินการแทน'
          : null,
      }
    }),
    pendingInvites: invites.map((invite) => {
      const expiresMs = Date.parse(invite.expiresAt)
      // An unparseable timestamp reads as expired: the fail-closed direction,
      // and it matches acceptance, which refuses anything it cannot trust.
      const expired = !Number.isFinite(expiresMs) || expiresMs <= at
      return {
        ...invite,
        roleLabel: workspaceRoleLabel(invite.role),
        expired,
        audienceLabel: invite.invitedEmail
          ? `ส่งถึง ${invite.invitedEmail}`
          : invite.targetName
            ? `ระบุถึง ${invite.targetName}`
            : 'รหัสทั่วไป — ส่งมอบให้ผู้รับโดยตรง',
      }
    }),
  }
}

/** Dialog copy for a decision that cannot be undone (UI-DESIGN-SYSTEM §4). */
export function confirmRevokeInviteMessage(invite) {
  const audience = invite?.audienceLabel || invite?.invitedEmail || invite?.targetName || 'ผู้ถือรหัสนี้'
  return `ยกเลิกคำเชิญนี้ (${audience})? รหัสที่ส่งไปแล้วจะใช้ไม่ได้อีก และการยกเลิกย้อนกลับไม่ได้ — ต้องออกรหัสใหม่แทน`
}

export function confirmRemoveMemberMessage(member) {
  const name = member?.displayName || member?.code || 'สมาชิกคนนี้'
  return `นำ ${name} (บทบาท ${workspaceRoleLabel(member?.role)}) ออกจาก Workspace? สิทธิ์การทำงานร่วมกันจะถูกถอนทันที และต้องเชิญใหม่หากต้องการให้กลับเข้ามา`
}

const ACTION_PREFIX_TH = {
  LOAD: 'โหลดรายชื่อสมาชิกไม่สำเร็จ',
  MINT: 'ออกรหัสเชิญไม่สำเร็จ',
  REVOKE: 'ยกเลิกคำเชิญไม่สำเร็จ',
  REMOVE: 'นำสมาชิกออกไม่สำเร็จ',
}

// The refusals this panel's three endpoints actually produce. Anything not
// listed still reaches the person verbatim — an unexplained refusal is far
// better than a friendly sentence that hides which one it was.
const SERVER_REFUSAL_TH = {
  'Workspace not found': 'ไม่พบ Workspace นี้ หรือคุณไม่มีสิทธิ์จัดการ',
  'Invite not found': 'ไม่พบคำเชิญนี้ — อาจถูกลบหรือโหลดค้างอยู่',
  'Membership not found': 'ไม่พบสมาชิกคนนี้ใน Workspace — อาจถูกนำออกไปแล้ว',
  INVITE_NOT_PENDING: 'คำเชิญนี้ถูกใช้หรือยกเลิกไปแล้ว',
  INVITE_ROLE_NOT_ALLOWED: 'บทบาทนี้ออกรหัสเชิญไม่ได้',
  TARGET_PERSON_INVALID: 'ผู้รับที่ระบุไม่ถูกต้อง',
  'Person not found': 'ไม่พบบุคคลที่ระบุ',
  AUTH_REQUIRED: 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่อีกครั้ง',
}

/**
 * A refusal the person can act on, with the server's own words kept inside it.
 * A mutation that cannot report its own failure reports success by saying
 * nothing, and a translation that drops the original says almost as little.
 */
export function describeRefusal(action, message) {
  const raw = nonEmpty(message) ? message.trim() : 'ไม่ทราบสาเหตุ'
  const prefix = ACTION_PREFIX_TH[action] || 'ทำรายการไม่สำเร็จ'
  const explained = SERVER_REFUSAL_TH[raw]
  return explained ? `${prefix}: ${explained} (${raw})` : `${prefix}: ${raw}`
}

/**
 * The mint response, shaped for its one showing. `origin` is passed in rather
 * than read from `window`, so this stays pure and testable.
 *
 * There is no accept-by-link route — acceptance is the Waiting Room's paste
 * field — so the share text carries the code plus where to enter it, and this
 * adds no new surface.
 */
export function describeMintResult(result, { origin = '' } = {}) {
  if (!result || !nonEmpty(result.inviteToken)) return null
  const base = typeof origin === 'string' ? origin.replace(/\/+$/, '') : ''
  const acceptUrl = `${base}/waiting-room`
  const label = workspaceRoleLabel(result.role)
  return {
    inviteId: result.inviteId || null,
    portfolioId: result.portfolioId || null,
    inviteToken: result.inviteToken,
    role: result.role || null,
    roleLabel: label,
    expiresAt: result.expiresAt || null,
    acceptUrl,
    shareText: [
      `คำเชิญเข้าร่วม Workspace (บทบาท ${label})`,
      `รหัสเชิญ: ${result.inviteToken}`,
      `นำรหัสไปกรอกที่ ${acceptUrl}`,
      `รหัสใช้ได้ครั้งเดียว หมดอายุ ${result.expiresAt || 'ตามกำหนดของระบบ'}`,
    ].join('\n'),
  }
}
