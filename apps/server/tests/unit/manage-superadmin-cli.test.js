// @req FR-200 — CLI cannot silently choose the wrong identity or expiry.
// @spec ADR-082, SEC-008, SEC-027
import { describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../scripts/manage-superadmin.mjs'

const args = ['grant', '--email', 'target@example.com', '--actor-email', 'actor@example.com', '--reason', 'Approved access', '--expires-at', '2026-12-01T00:00:00Z']
describe('Superadmin CLI', () => {
  it('requires explicit action, actor, target, reason and grant expiry', () => {
    expect(parseArgs(args)).toMatchObject({ action: 'grant', email: 'target@example.com' })
    expect(() => parseArgs(args.slice(0, -2))).toThrow('SUPERADMIN_CLI_REQUIRES')
    expect(() => parseArgs([...args, '--email', 'other@example.com'])).toThrow('SUPERADMIN_CLI_INVALID')
    expect(() => parseArgs(['bootstrap', ...args.slice(1)])).toThrow('SUPERADMIN_ACTION')
  })
  it.each([{ rows: [] }, { rows: [{ id: 'one', email: 'TARGET@example.com' }, { id: 'two', email: 'target@example.com' }] }])('refuses absent or case-ambiguous identities without a write', async ({ rows }) => {
    const db = { person: { findMany: vi.fn().mockResolvedValue(rows) }, $transaction: vi.fn() }
    await expect(main(args, { db })).rejects.toThrow('SUPERADMIN_EMAIL_MISSING_OR_AMBIGUOUS')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
