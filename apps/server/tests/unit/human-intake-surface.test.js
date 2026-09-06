import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('human intake surface', () => {
  it('keeps project creation on the objective wizard instead of a second modal path', () => {
    const source = read('src/app/(pm)/projects/page.jsx')
    expect(source).toContain('href="/projects/new"')
    expect(source).not.toContain('searchParams.get(\'new\')')
  })

  it('does not expose direct workstream creation from project detail', () => {
    const source = read('src/app/(pm)/projects/[projectId]/page.jsx')
    expect(source).not.toContain('New workstream')
  })

  it('does not expose direct item creation from execution views', () => {
    const source = read('src/modules/project-manager/views/execution/ExecutionModeView.jsx')
    expect(source).not.toContain('Add item')
  })
})
