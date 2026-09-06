import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const view = readFileSync(resolve(process.cwd(), 'src/modules/people/components/PeopleDirectory.jsx'), 'utf8')

describe('HR / People directory boundary', () => {
  it('keeps People distinct from Project Team', () => {
    expect(view).toContain('People Directory')
    expect(view).toContain('Project Team is a separate Project-local view')
    expect(view).toContain('/api/people?businessId=')
  })
})
