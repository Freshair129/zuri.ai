import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const component = read('src/modules/project-manager/components/BusinessWigExecution.jsx')
const overview = read('src/app/(pm)/overview/page.jsx')

describe('FR-270 Business WIG execution UI', () => {
  it('renders the Business strategy projection on Overview and gates mutations on the current Business owner grant', () => {
    expect(overview).toContain("import BusinessWigExecution from '@/modules/project-manager/components/BusinessWigExecution'")
    expect(overview).toContain('<BusinessWigExecution')
    expect(overview).toContain('canManage={isOwner}')
    expect(component).toContain('canManage && (')
  })

  it('provides controls for WIG/lag selection, lead measure corrections, weekly commitments, completion and session steps', () => {
    for (const text of [
      'Set as WIG', 'Save lag', 'lead-measures', 'Record correction',
      'weekly-commitments', 'Commitment completed: ${row.title}', 'Weekly WIG session',
      'business/wig-sessions/steps', 'last five weeks',
    ]) {
      // Some labels are composed in JSX; assert the concrete request/behavior
      // token that backs the user-visible control.
      expect(component.toLowerCase()).toContain(text.toLowerCase())
    }
    expect(component).toContain("isWig ? { isWig: true, lagKeyResultId: selected } : { isWig: false }")
    expect(component).toContain("method: 'PUT', body: { businessId, weekStartAt: execution.currentWeekStartAt, step, completed: event.target.checked }")
  })

  it('assigns commitments from the direct active Business member DTO, and never asks the People domain for a wider roster', () => {
    expect(component).toContain('const directMembers = execution?.commitmentPeople || []')
    expect(component).toContain('Choose a Business member')
    expect(component).toContain('No active direct Business members are available for assignment.')
    expect(component).not.toContain('/api/people')
  })
})
