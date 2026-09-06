import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zPlanEnvelope, validatePlanSemantics } from '@/modules/project-manager/import/plan-schema'

// @req FR-012, FR-069 — every PlanEnvelope artifact this repository publishes must be
//   importable through the one intake pipeline it was written for.
// @spec BR-004, BR-009 — one envelope, one validation; a sample plan that the pipeline
//   rejects is not a sample, it is a broken artifact.
// @tested tests/unit/contract-plan-artifacts.test.js
//
// This exists because `contracts/zuri-v2-self-plan.json` (generated) and
// `contracts/zuri-v2-dev-plan.json` (hand-written) both carried item subtypes belonging
// to a different execution mode — `APPROVAL` and `DELIVERABLE` inside SOFTWARE_SPRINT /
// OPERATIONS workstreams — so a dry run of either failed on every one of those items.
// Nothing checked the published artifacts against the validator that governs them.
//
// The file list is READ FROM THE DIRECTORY, not typed here: a sample plan added
// tomorrow is covered the day it lands, which is the only way this guard stays true.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CONTRACTS = path.join(ROOT, 'contracts')

function planArtifacts() {
  return readdirSync(CONTRACTS)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.schema.json'))
    .map((name) => ({ name, raw: JSON.parse(readFileSync(path.join(CONTRACTS, name), 'utf8')) }))
    // A PlanEnvelope is the thing with a project and workstreams; approvals, seed data
    // and receipts living in the same folder are not, and must not be forced through
    // this validator.
    .filter(({ raw }) => raw && typeof raw === 'object' && raw.project && Array.isArray(raw.workstreams))
}

describe('published PlanEnvelope artifacts pass the intake pipeline', () => {
  const artifacts = planArtifacts()

  it('finds the plan artifacts to check', () => {
    expect(artifacts.length).toBeGreaterThan(0)
    expect(artifacts.map((a) => a.name)).toContain('zuri-v2-self-plan.json')
  })

  for (const { name, raw } of artifacts) {
    it(`${name} parses against the envelope schema`, () => {
      const parsed = zPlanEnvelope.safeParse(raw)
      const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      expect(issues).toEqual([])
    })

    it(`${name} satisfies the execution-mode contract`, () => {
      expect(validatePlanSemantics(raw)).toEqual([])
    })
  }
})
