import { describe, expect, it, vi } from 'vitest'

import { listBusinessBranchFacts, readBranchFact } from '@/modules/project-manager/application/branch-reference-reader'

// @req FR-183, FR-194 — project-manager's read port for the scm-core.v1 Branch
//   facts (ADR-111 D5): Tenant-bounded, null on a miss, and only the contract's columns.
// @spec ADR-111, BR-001, SEC-001

// Rows carry more than the port may answer: nothing beyond the allow-list leaves.
const BRANCHES = [
  { id: 'br-2', code: 'BR-2', name: 'Synthetic North', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-1', businessId: 'b-1', taxBranchCode: '00001', phone: '000' },
  { id: 'br-1', code: 'BR-1', name: 'Synthetic Main', address: '1 Synthetic Rd', kind: 'SITE', status: 'INACTIVE', tenantId: 't-1', businessId: 'b-1', taxBranchCode: '00000' },
  { id: 'br-other-biz', code: 'BR-9', name: 'Other Business', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-1', businessId: 'b-2' },
  { id: 'br-x', code: 'BR-X', name: 'Other Tenant', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-2', businessId: 'b-x' },
]

// Honours where/orderBy/take like Prisma but, unless asked, returns EVERY column so
// the port's own projection is what the allow-list assertions check.
function fakeDb({ honourSelect = false } = {}) {
  const project = (row, select) => (honourSelect ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row })
  return {
    branch: {
      findUnique: vi.fn(async ({ where, select }) => {
        const row = BRANCHES.find((candidate) => candidate.id === where.id)
        return row ? project(row, select) : null
      }),
      findMany: vi.fn(async ({ where, orderBy, take, select }) => {
        expect(orderBy).toEqual([{ code: 'asc' }])
        return BRANCHES
          .filter((row) => row.tenantId === where.tenantId && row.businessId === where.businessId)
          .sort((a, b) => a.code.localeCompare(b.code))
          .slice(0, take)
          .map((row) => project(row, select))
      }),
    },
  }
}

describe('project-manager branch-reference-reader: readBranchFact', () => {
  it('answers only the contract columns for a Branch of the Tenant', async () => {
    const db = fakeDb()
    expect(await readBranchFact({ tenantId: 't-1', branchId: 'br-2' }, { db }))
      .toEqual({ id: 'br-2', code: 'BR-2', name: 'Synthetic North', tenantId: 't-1', businessId: 'b-1', status: 'ACTIVE' })
    expect(db.branch.findUnique).toHaveBeenCalledWith({
      where: { id: 'br-2' },
      select: { id: true, code: true, name: true, tenantId: true, businessId: true, status: true },
    })
  })

  it('answers null for another Tenant, a missing id or malformed input, and never queries on malformed input', async () => {
    const db = fakeDb()
    expect(await readBranchFact({ tenantId: 't-1', branchId: 'br-x' }, { db })).toBeNull()
    expect(await readBranchFact({ tenantId: 't-1', branchId: 'missing' }, { db })).toBeNull()
    const calls = db.branch.findUnique.mock.calls.length
    for (const input of [{}, { tenantId: 't-1' }, { branchId: 'br-2' }, { tenantId: '', branchId: 'br-2' }, { tenantId: 't-1', branchId: 42 }]) {
      expect(await readBranchFact(input, { db })).toBeNull()
    }
    expect(db.branch.findUnique.mock.calls.length).toBe(calls)
  })
})

describe('project-manager branch-reference-reader: listBusinessBranchFacts', () => {
  it('lists every Branch of that Business (any status), ordered by code, with only the contract columns', async () => {
    const db = fakeDb()
    expect(await listBusinessBranchFacts({ tenantId: 't-1', businessId: 'b-1', limit: 10 }, { db })).toEqual([
      { id: 'br-1', code: 'BR-1', name: 'Synthetic Main', address: '1 Synthetic Rd', kind: 'SITE', status: 'INACTIVE', tenantId: 't-1', businessId: 'b-1' },
      { id: 'br-2', code: 'BR-2', name: 'Synthetic North', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 't-1', businessId: 'b-1' },
    ])
  })

  it('is bounded by Tenant and Business and honours the limit the caller passes', async () => {
    const db = fakeDb({ honourSelect: true })
    expect(await listBusinessBranchFacts({ tenantId: 't-2', businessId: 'b-1', limit: 10 }, { db })).toEqual([])
    expect((await listBusinessBranchFacts({ tenantId: 't-1', businessId: 'b-1', limit: 1 }, { db })).map((row) => row.id)).toEqual(['br-1'])
    expect(db.branch.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 't-1', businessId: 'b-1' }, take: 1 }))
  })

  it('answers [] without querying for malformed input or a missing limit', async () => {
    const db = fakeDb()
    for (const input of [{}, { tenantId: 't-1', businessId: 'b-1' }, { tenantId: 't-1', businessId: 'b-1', limit: 0 }, { tenantId: 't-1', limit: 5 }]) {
      expect(await listBusinessBranchFacts(input, { db })).toEqual([])
    }
    expect(db.branch.findMany).not.toHaveBeenCalled()
  })
})
