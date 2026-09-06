// @req FR-087 — the Project edit path must not rewrite a field the editor did
// not touch.
// @spec ADR-036 D3
// @tested tests/unit/project-status-options.test.js
import { describe, expect, it } from 'vitest'
import { PROJECT_STATUSES, WORK_STATUSES } from '@/lib/validation/enums'
import {
  projectStatusOptions,
  unrecognizedProjectStatus,
} from '@/modules/project-manager/components/project-status-options'

describe('Project status options', () => {
  it('offers exactly the declared statuses when the stored one is declared', () => {
    for (const status of PROJECT_STATUSES) {
      expect(projectStatusOptions(status)).toEqual(PROJECT_STATUSES)
      expect(unrecognizedProjectStatus(status)).toBeNull()
    }
  })

  it('offers exactly the declared statuses for a Project with no status yet', () => {
    expect(projectStatusOptions(null)).toEqual(PROJECT_STATUSES)
    expect(projectStatusOptions(undefined)).toEqual(PROJECT_STATUSES)
    expect(projectStatusOptions('')).toEqual(PROJECT_STATUSES)
    expect(unrecognizedProjectStatus(null)).toBeNull()
  })

  it('includes a stored status the enum does not declare, so a select can show it', () => {
    // The real row: production held IN_PROGRESS on a Project. Without this the
    // <select> matches no option, the browser selects the first one (PLANNED),
    // and the next save of an unrelated field writes PLANNED over it.
    const options = projectStatusOptions('IN_PROGRESS')
    expect(options).toContain('IN_PROGRESS')
    expect(options[0]).toBe('IN_PROGRESS')
    expect(unrecognizedProjectStatus('IN_PROGRESS')).toBe('IN_PROGRESS')
    // Every declared status is still offered, so the editor can correct it.
    for (const status of PROJECT_STATUSES) expect(options).toContain(status)
  })

  it('treats any WORK_STATUSES value a Project does not share as unrecognized', () => {
    // A Project is a grouping, not a unit of work: PROJECT_STATUSES and
    // WORK_STATUSES overlap only on PLANNED and DONE. The rest arriving on a
    // Project row means the value came from somewhere that is not this enum.
    const workOnly = WORK_STATUSES.filter((status) => !PROJECT_STATUSES.includes(status))
    expect(workOnly.length).toBeGreaterThan(0)
    for (const status of workOnly) {
      expect(unrecognizedProjectStatus(status)).toBe(status)
      expect(projectStatusOptions(status)[0]).toBe(status)
    }
  })

  it('never drops or reorders the declared statuses', () => {
    // The unrecognized value is prepended, never substituted: an editor must
    // still be able to pick any real status to correct the row.
    expect(projectStatusOptions('IN_PROGRESS').slice(1)).toEqual(PROJECT_STATUSES)
  })
})
