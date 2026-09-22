import { describe, expect, it } from 'vitest'
import { POST as dryRun } from '@/app/api/import/meeting-actions/dry-run/route'
import { POST as commit } from '@/app/api/import/meeting-actions/commit/route'
import { POST as bind } from '@/app/api/identity/meeting-bindings/route'

describe('meeting action route surface', () => {
  it('exposes separate preview, commit and identity-binding entry points', () => {
    expect(typeof dryRun).toBe('function')
    expect(typeof commit).toBe('function')
    expect(typeof bind).toBe('function')
  })
})
