import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = readFileSync(resolve(process.cwd(), 'src/app/api/business/strategy/route.js'), 'utf8')

describe('Business Strategy API contract', () => {
  it('requires the viewer gate and delegates by businessId', () => {
    expect(route).toContain('resolveRequestViewer(request)')
    expect(route).toContain('businessId')
    expect(route).toContain('getBusinessStrategy')
  })
})
