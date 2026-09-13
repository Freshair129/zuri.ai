// @req FR-219 — evidence badge colours: green done, orange review, red needs fix,
//   gray empty, for links and for the FR/NFR/FEAT ids a task delivers read against
//   the FR-124 snapshot; neutral domain, complexity and priority descriptors.
// @spec ADR-086 D6; NFR-008
// @tested tests/unit/program-task-evidence.test.js
import { describe, expect, it } from 'vitest'
import { projectTaskEvidence, snapshotIndex, taskEvidence, TONE_WORD } from '@/modules/platform-control/program-task-evidence'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'

const snapshot = {
  features: [
    { id: 'FEAT-100', readiness: 'ready', progressPercent: 100, primaryDomain: 'inventory', requirementIds: ['FR-500', 'FR-501'] },
    { id: 'FEAT-101', readiness: 'not_ready', progressPercent: 60, primaryDomain: 'knowledge', requirementIds: ['FR-502'] },
  ],
  domains: {
    inventory: { requirements: [{ id: 'FR-500', status: 'verified' }, { id: 'FR-501', status: 'verified' }] },
    knowledge: { requirements: [{ id: 'FR-502', status: 'planned' }, { id: 'FR-503', status: 'partial' }] },
  },
  nonFunctionalRequirements: [{ id: 'NFR-010', status: 'not_implemented', domains: ['platform-control'] }],
}
const index = snapshotIndex(snapshot)
const container = (over = {}) => ({
  priority: 'P0',
  links: { code: 'apps/server/src/modules/inventory/x.js', doc: 'docs/x.md', test: 'unavailable' },
  linkState: { code: 'present', doc: 'missing', test: 'unavailable' },
  delivers: [],
  ...over,
})
const task = (status, complexity = 'C-3') => ['TASK-ZAI-900', 'SPR-ZAI-02', 'title', 'FR', complexity, 'H3', status]
const tone = (evidence, key) => evidence.evidence.find((b) => b.key === key).tone

describe('FR-219 link badges', () => {
  it('is green on a done task, orange in review, red when the path is gone, gray when empty or not yet reviewed', () => {
    expect(tone(taskEvidence({ task: task('done'), container: container(), index }), 'CODE')).toBe('done')
    expect(tone(taskEvidence({ task: task('review'), container: container(), index }), 'CODE')).toBe('review')
    expect(tone(taskEvidence({ task: task('planned'), container: container(), index }), 'CODE')).toBe('empty')
    expect(tone(taskEvidence({ task: task('done'), container: container(), index }), 'DOC')).toBe('fix')
    expect(tone(taskEvidence({ task: task('done'), container: container(), index }), 'TEST')).toBe('empty')
  })
})

describe('FR-219 requirement badges', () => {
  it('is green when every delivered id is built, orange when partly built', () => {
    const done = taskEvidence({ task: task('done'), container: container({ delivers: ['FEAT-100', 'FR-500', 'FR-501'] }), index })
    expect(tone(done, 'FR')).toBe('done')
    expect(tone(done, 'FEAT')).toBe('done')
    expect(tone(done, 'NFR')).toBe('empty')
    const partial = taskEvidence({ task: task('in-progress'), container: container({ delivers: ['FEAT-101', 'FR-503'] }), index })
    expect(tone(partial, 'FR')).toBe('review')
    expect(tone(partial, 'FEAT')).toBe('review')
  })

  it('is red for an id the snapshot does not know, or a done/review task whose id is not built', () => {
    expect(tone(taskEvidence({ task: task('planned'), container: container({ delivers: ['FR-999'] }), index }), 'FR')).toBe('fix')
    expect(tone(taskEvidence({ task: task('review'), container: container({ delivers: ['FR-502'] }), index }), 'FR')).toBe('fix')
    expect(tone(taskEvidence({ task: task('done'), container: container({ delivers: ['NFR-010'] }), index }), 'NFR')).toBe('fix')
    // The same unbuilt id on a planned task is simply not started yet.
    expect(tone(taskEvidence({ task: task('planned'), container: container({ delivers: ['FR-502'] }), index }), 'FR')).toBe('empty')
  })

  it('names the domain from the delivered FEAT, then the FR, then the code link, and shows complexity and priority', () => {
    const byFeat = taskEvidence({ task: task('done', 'C-2'), container: container({ delivers: ['FR-502', 'FEAT-100'] }), index })
    expect(byFeat.descriptors.map((d) => d.label)).toEqual(['DOM-INVENTORY', 'C-2', 'P0'])
    expect(taskEvidence({ task: task('done'), container: container({ delivers: ['FR-503'] }), index }).descriptors[0].label).toBe('DOM-KNOWLEDGE')
    expect(taskEvidence({ task: task('done'), container: container(), index }).descriptors[0].label).toBe('DOM-INVENTORY')
    expect(taskEvidence({ task: task('done'), container: container({ links: { code: 'unavailable' } }), index }).descriptors[0].label).toBe('DOM-—')
  })

  it('pairs every tone with a word', () => {
    for (const t of ['done', 'review', 'fix', 'empty']) expect(TONE_WORD[t]).toBeTruthy()
  })
})

describe('FR-219 against the real programme', () => {
  it('produces nine badges for every task from the committed containers and snapshot', () => {
    const evidence = projectTaskEvidence({ tasks: PROGRAMME_TASKS, containers: PROGRAMME_CONTAINERS, snapshot: getProductReadinessSnapshot() })
    expect(Object.keys(evidence)).toHaveLength(PROGRAMME_TASKS.length)
    for (const e of Object.values(evidence)) {
      expect(e.evidence.map((b) => b.key)).toEqual(['DOC', 'CODE', 'TEST', 'FR', 'NFR', 'FEAT'])
      expect(e.descriptors.map((d) => d.key)).toEqual(['DOMAIN', 'COMPLEXITY', 'PRIORITY'])
    }
    // A task whose FR the snapshot records as verified and which is done reads green.
    expect(evidence['TASK-ZAI-005'].evidence.find((b) => b.key === 'FR').tone).toBe('done')
  })
})
