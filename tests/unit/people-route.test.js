import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = readFileSync(resolve(process.cwd(), 'src/app/api/people/route.js'), 'utf8')

describe('HR / People API contract', () => {
  it('uses resolveViewer before the Business directory service', () => {
    expect(route).toContain('resolveViewer')
    expect(route).toContain('listPeople')
    expect(route).toContain('visibleBusinessIds')
  })
})
