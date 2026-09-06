// @req FR-067 — the owner-side collaboration panel's decisions, tested where
// they live: which Workspaces show the panel, what each control sends, what a
// destructive control asks first, how a server refusal reads, and that the
// minted token is handed over exactly once. The JSX has no rendering harness in
// this repo, which is precisely why none of this logic is in it.
// @spec ADR-027 D5/D6/D9, BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-collaboration-view.test.js
import { describe, expect, it } from 'vitest'
import { WORKSPACE_INVITE_ROLES } from '@/lib/validation/enums'
import {
  DEFAULT_INVITE_ROLE,
  MINTABLE_ROLE_OPTIONS,
  buildMintRequest,
  buildRemoveMemberRequest,
  buildRevokeRequest,
  buildRosterView,
  confirmRemoveMemberMessage,
  confirmRevokeInviteMessage,
  describeMintResult,
  describeRefusal,
  rosterPath,
  selectAdministrableWorkspaces,
  workspaceRoleLabel,
} from '@/modules/identity/workspace-collaboration-view'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-09-02T00:00:00.000Z')

describe('who sees the owner panel (ADR-027 D6)', () => {
  it('selects only the Workspaces the server itself reported as OWNER', () => {
    const state = {
      workspaces: [
        { portfolioId: 'pf-own', name: 'ของฉัน', role: 'OWNER' },
        { portfolioId: 'pf-admin', name: 'ผู้ดูแล', role: 'ADMIN' },
        { portfolioId: 'pf-member', name: 'สมาชิก', role: 'MEMBER' },
      ],
    }
    expect(selectAdministrableWorkspaces(state).map((w) => w.portfolioId)).toEqual(['pf-own'])
  })

  it('ADMIN is not Workspace administration — the service refuses it, so the panel must not offer it', () => {
    const state = { workspaces: [{ portfolioId: 'pf-1', name: 'x', role: 'ADMIN' }] }
    expect(selectAdministrableWorkspaces(state)).toEqual([])
  })

  it('degrades to no panel on a missing, empty or malformed read model', () => {
    expect(selectAdministrableWorkspaces(null)).toEqual([])
    expect(selectAdministrableWorkspaces({})).toEqual([])
    expect(selectAdministrableWorkspaces({ workspaces: 'OWNER' })).toEqual([])
    // A row with the right role but no id would build a request to nowhere.
    expect(selectAdministrableWorkspaces({ workspaces: [{ role: 'OWNER', portfolioId: '' }] })).toEqual([])
  })

  it('reads no request path until a Workspace is chosen', () => {
    expect(rosterPath('')).toBeNull()
    expect(rosterPath(null)).toBeNull()
    expect(rosterPath('pf 1/2')).toBe('/api/workspace-memberships?portfolioId=pf%201%2F2')
  })
})

describe('mint request (AC-067.1, AC-067.6)', () => {
  it('builds the body the route schema accepts', () => {
    const { error, request } = buildMintRequest({ portfolioId: 'pf-1', role: 'ADMIN', invitedEmail: ' Ann@Example.com ' })
    expect(error).toBeNull()
    expect(request).toEqual({
      path: '/api/workspace-invites',
      method: 'POST',
      body: { portfolioId: 'pf-1', role: 'ADMIN', invitedEmail: 'Ann@Example.com' },
    })
  })

  it('omits invitedEmail entirely when blank — the route rejects an empty string', () => {
    const { request } = buildMintRequest({ portfolioId: 'pf-1', invitedEmail: '   ' })
    expect(Object.keys(request.body)).toEqual(['portfolioId', 'role'])
    expect(request.body.role).toBe(DEFAULT_INVITE_ROLE)
  })

  it('never offers or sends OWNER — a token can never mint ownership', () => {
    expect(WORKSPACE_INVITE_ROLES).not.toContain('OWNER')
    expect(MINTABLE_ROLE_OPTIONS.map((o) => o.value)).toEqual(WORKSPACE_INVITE_ROLES)
    const { error, request } = buildMintRequest({ portfolioId: 'pf-1', role: 'OWNER' })
    expect(request).toBeNull()
    expect(error).toMatch(/OWNER/)
  })

  it('refuses without a Workspace, and explains how to correct a bad email', () => {
    expect(buildMintRequest({ role: 'MEMBER' }).request).toBeNull()
    const bad = buildMintRequest({ portfolioId: 'pf-1', invitedEmail: 'not-an-email' })
    expect(bad.request).toBeNull()
    expect(bad.error).toContain('name@example.com')
  })
})

describe('revoke and remove requests (AC-067.2, AC-067.7)', () => {
  it('addresses the invite by id, escaped', () => {
    expect(buildRevokeRequest('inv/1').request).toEqual({
      path: '/api/workspace-invites/inv%2F1',
      method: 'DELETE',
    })
    expect(buildRevokeRequest('').request).toBeNull()
  })

  it('sends both scope keys the removal route requires', () => {
    const { request } = buildRemoveMemberRequest({ portfolioId: 'pf-1', personId: 'per-2' })
    expect(request.method).toBe('DELETE')
    const query = new URL(request.path, 'http://local').searchParams
    expect(query.get('portfolioId')).toBe('pf-1')
    expect(query.get('personId')).toBe('per-2')
  })

  it('refuses to build a removal missing either half of the target', () => {
    expect(buildRemoveMemberRequest({ personId: 'per-2' }).request).toBeNull()
    expect(buildRemoveMemberRequest({ portfolioId: 'pf-1' }).request).toBeNull()
  })
})

describe('roster view', () => {
  const roster = {
    portfolioId: 'pf-1',
    members: [
      { personId: 'per-me', code: 'PER-1', displayName: 'เจ้าของ', role: 'OWNER', joinedAt: '2026-08-01T00:00:00.000Z', isSelf: true },
      { personId: 'per-2', code: 'PER-2', displayName: 'สมทรง', role: 'MEMBER', joinedAt: '2026-08-05T00:00:00.000Z', isSelf: false },
    ],
    pendingInvites: [
      { id: 'inv-live', role: 'MEMBER', invitedEmail: 'ann@example.com', targetPersonId: null, targetName: null, expiresAt: new Date(NOW + HOUR).toISOString() },
      { id: 'inv-dead', role: 'ADMIN', invitedEmail: null, targetPersonId: 'per-3', targetName: 'ปรีชา', expiresAt: new Date(NOW - HOUR).toISOString() },
    ],
  }

  it('blocks self-removal and allows removing anyone else, including another OWNER', () => {
    const view = buildRosterView(roster, { now: NOW })
    const [self, other] = view.members
    expect(self.isSelf).toBe(true)
    expect(self.canRemove).toBe(false)
    expect(self.removeBlockedReason).toBeTruthy()
    expect(other.canRemove).toBe(true)
    expect(other.removeBlockedReason).toBeNull()
  })

  it('falls back to comparing the viewer id when the server did not mark self', () => {
    const unmarked = { members: [{ personId: 'per-2', displayName: 'สมทรง', role: 'MEMBER' }], pendingInvites: [] }
    expect(buildRosterView(unmarked, { viewerPersonId: 'per-2' }).members[0].canRemove).toBe(false)
    expect(buildRosterView(unmarked, { viewerPersonId: 'per-9' }).members[0].canRemove).toBe(true)
  })

  it('classifies expiry against now, and names each invite audience', () => {
    const view = buildRosterView(roster, { now: NOW })
    expect(view.pendingCount).toBe(2)
    expect(view.pendingInvites[0].expired).toBe(false)
    expect(view.pendingInvites[0].audienceLabel).toContain('ann@example.com')
    expect(view.pendingInvites[1].expired).toBe(true)
    expect(view.pendingInvites[1].audienceLabel).toContain('ปรีชา')
  })

  it('reads an unparseable or absent expiry as expired, never as still valid', () => {
    const view = buildRosterView(
      { members: [], pendingInvites: [{ id: 'inv-x', role: 'MEMBER' }, { id: 'inv-y', role: 'MEMBER', expiresAt: 'soon' }] },
      { now: NOW },
    )
    expect(view.pendingInvites.map((i) => i.expired)).toEqual([true, true])
  })

  it('survives a missing or half-shaped roster', () => {
    const empty = buildRosterView(null)
    expect(empty).toMatchObject({ memberCount: 0, pendingCount: 0, members: [], pendingInvites: [] })
    expect(buildRosterView({ members: 'nope' }).members).toEqual([])
  })

  it('labels roles in Thai and leaves an unknown role legible', () => {
    expect(workspaceRoleLabel('OWNER')).toBe('เจ้าของ')
    expect(workspaceRoleLabel('MEMBER')).toBe('สมาชิก')
    expect(workspaceRoleLabel('FUTURE_ROLE')).toBe('FUTURE_ROLE')
  })
})

describe('confirmation before a destructive call', () => {
  it('says what is lost and that it cannot be undone', () => {
    const message = confirmRevokeInviteMessage({ id: 'inv-1', audienceLabel: 'ส่งถึง ann@example.com' })
    expect(message).toContain('ann@example.com')
    expect(message).toMatch(/ย้อนกลับไม่ได้/)
  })

  it('names the member and their role', () => {
    const message = confirmRemoveMemberMessage({ displayName: 'สมทรง', role: 'MEMBER' })
    expect(message).toContain('สมทรง')
    expect(message).toContain('สมาชิก')
  })

  it('still asks something sensible for a row missing its name', () => {
    expect(confirmRemoveMemberMessage({})).toMatch(/สมาชิกคนนี้/)
    expect(confirmRevokeInviteMessage(null)).toMatch(/ผู้ถือรหัสนี้/)
  })
})

describe('a refusal always reaches the person (client-mutation rule)', () => {
  it('explains the refusals these endpoints actually produce, keeping the server text', () => {
    expect(describeRefusal('REVOKE', 'INVITE_NOT_PENDING'))
      .toBe('ยกเลิกคำเชิญไม่สำเร็จ: คำเชิญนี้ถูกใช้หรือยกเลิกไปแล้ว (INVITE_NOT_PENDING)')
    expect(describeRefusal('REMOVE', 'Workspace not found')).toContain('ไม่มีสิทธิ์จัดการ')
    expect(describeRefusal('LOAD', 'Workspace not found')).toMatch(/^โหลดรายชื่อสมาชิกไม่สำเร็จ/)
  })

  it('passes an unrecognised refusal through verbatim rather than inventing one', () => {
    const message = describeRefusal('MINT', 'Validation failed: role: Invalid enum value')
    expect(message).toContain('Validation failed: role: Invalid enum value')
  })

  it('never returns an empty explanation, even for an empty error', () => {
    expect(describeRefusal('MINT', '')).toMatch(/ไม่ทราบสาเหตุ/)
    expect(describeRefusal('WHAT', undefined)).toMatch(/ทำรายการไม่สำเร็จ/)
  })
})

describe('the minted token is handed over once (SEC-014)', () => {
  const minted = {
    inviteId: 'inv-1',
    inviteToken: 'a'.repeat(64),
    portfolioId: 'pf-1',
    role: 'MEMBER',
    expiresAt: '2026-09-09T00:00:00.000Z',
  }

  it('carries the code, where to enter it, and its expiry', () => {
    const view = describeMintResult(minted, { origin: 'https://app.example.com/' })
    expect(view.inviteToken).toBe(minted.inviteToken)
    expect(view.acceptUrl).toBe('https://app.example.com/waiting-room')
    expect(view.shareText).toContain(minted.inviteToken)
    expect(view.shareText).toContain('https://app.example.com/waiting-room')
    expect(view.shareText).toContain(minted.expiresAt)
    // Bound to its Workspace, so switching Workspaces cannot show it again.
    expect(view.portfolioId).toBe('pf-1')
  })

  it('is nothing at all when there is no token to show', () => {
    expect(describeMintResult(null)).toBeNull()
    expect(describeMintResult({ inviteId: 'inv-1' })).toBeNull()
    expect(describeMintResult({ inviteToken: '' })).toBeNull()
  })
})
