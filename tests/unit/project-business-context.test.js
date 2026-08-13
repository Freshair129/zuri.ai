// @req FR-043 - Project detail context names Business first and Space second.
// @spec ADR-014, SDD-021
// @tested tests/unit/project-business-context.test.js
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const source = fs.readFileSync('src/app/(pm)/projects/[projectId]/page.jsx', 'utf8')

describe('Project Business context', () => {
  it('renders Business as the primary context and Space as secondary metadata', () => {
    expect(source).toContain("p.business?.name || 'Shared project'")
    expect(source).toContain('Space: ${p.workspace?.code ||')
    expect(source).not.toContain('eyebrow={`${p.workspace?.code ||')
  })
})
