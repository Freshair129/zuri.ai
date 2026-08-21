import { describe, expect, it, vi } from 'vitest'
import {
  listLineRegistry,
  saveLineGroup,
  saveLineUser,
} from '@/modules/integration/application/line-registry-service'

// @req FR-080 — Platform Integration metadata management for LINE channels and contacts
// @spec ADR-032, SEC-016, SDD-044
// @tested tests/unit/line-registry-service.test.js

describe('LINE Registry Service (Groups and Users)', () => {
  const devViewer = {
    id: 'usr-dev-1',
    personId: 'per-1',
    isPlatformDev: true,
  }

  it('validates LINE group ID format (must start with C)', async () => {
    const payload = {
      businessId: 'bus-1',
      name: 'Sales Team',
      groupId: 'U123456789', // Invalid: starts with U instead of C
      departmentType: 'SALES_TEAM',
    }

    await expect(saveLineGroup(payload, { resolve: () => devViewer })).rejects.toThrow(
      'LINE Group ID must start with C'
    )
  })

  it('validates LINE user ID format (must start with U)', async () => {
    const payload = {
      businessId: 'bus-1',
      displayName: 'Somchai Sales',
      userId: 'C123456789', // Invalid: starts with C instead of U
    }

    await expect(saveLineUser(payload, { resolve: () => devViewer })).rejects.toThrow(
      'LINE User ID must start with U'
    )
  })
})
