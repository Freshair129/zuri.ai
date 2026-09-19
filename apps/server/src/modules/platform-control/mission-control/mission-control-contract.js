import { z } from 'zod'

// @req FR-261 — Mission Control accepts only provenance-bound orchestration
// observations and preserves LIVE/SNAPSHOT/UNKNOWN/NOT_RUN semantics.
// @spec ADR-048 D3, ADR-086 D1/D7, ADR-092 D3, SDD-008
// @tested tests/unit/mission-control-contract.test.js

export const PORL_SCHEMA_VERSION = 'porl-observation.v1'
export const PORL_RUN_STATES = Object.freeze(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'])
export const PORL_FRESHNESS_STATES = Object.freeze(['LIVE', 'SNAPSHOT', 'UNKNOWN'])
export const PORL_CHECK_STATES = Object.freeze(['PASSED', 'FAILED', 'UNKNOWN', 'NOT_RUN'])
export const PORL_PROOF_SCOPES = Object.freeze(['SPEC', 'UNKNOWN', 'LOCAL', 'ISOLATED', 'HOSTED_CI', 'PRODUCTION'])

const ref = (max = 200) => z.string().trim().min(1).max(max)
const nullableRef = (max = 200) => ref(max).nullable()
const isoDate = z.string().datetime({ offset: true })
const commit = z.string().regex(/^[0-9a-f]{7,64}$/i)
const taskId = z.string().regex(/^TASK-ZAI-\d{3}$/)

const sourceSchema = z.object({
  kind: ref(80),
  ref: ref(200),
  observedAt: isoDate.nullable(),
  capturedAt: isoDate.nullable(),
}).strict()

const assignmentSchema = z.object({
  ownerRef: nullableRef(),
  workerRef: nullableRef(),
  threadRef: nullableRef(),
}).strict()

const revisionSchema = z.object({
  branch: nullableRef(),
  worktreeRef: nullableRef(),
  baseCommit: commit.nullable(),
  headCommit: commit.nullable(),
}).strict()

const checkSchema = z.object({
  kind: ref(80),
  state: z.enum(PORL_CHECK_STATES),
  scope: z.enum(PORL_PROOF_SCOPES),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
  evidenceRefs: z.array(ref(240)).max(200),
}).strict()

const changedFilesSchema = z.object({
  state: z.enum(['KNOWN', 'UNKNOWN', 'NOT_REPORTED']),
  paths: z.array(ref(400)).max(2000),
  sourceRef: nullableRef(240),
}).strict()

const blockerSchema = z.object({
  code: ref(100),
  state: z.enum(['BLOCKED', 'UNKNOWN', 'NOT_RUN']),
  sourceRef: nullableRef(240),
  reason: ref(500),
}).strict()

export const ProgrammeOrchestrationObservationSchema = z.object({
  schemaVersion: z.literal(PORL_SCHEMA_VERSION),
  observationId: ref(200),
  runRef: nullableRef(200),
  taskId,
  laneId: nullableRef(120),
  capabilityKey: nullableRef(160),
  assignment: assignmentSchema,
  revision: revisionSchema,
  runState: z.enum(PORL_RUN_STATES),
  freshness: z.enum(PORL_FRESHNESS_STATES),
  proofScope: z.enum(PORL_PROOF_SCOPES),
  source: sourceSchema,
  checks: z.array(checkSchema).max(100),
  changedFiles: changedFilesSchema,
  evidenceRefs: z.array(ref(240)).max(200),
  blockers: z.array(blockerSchema).max(50),
  reason: nullableRef(500),
}).strict().superRefine((observation, ctx) => {
  if (observation.freshness === 'LIVE' && !observation.source.observedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'observedAt'], message: 'LIVE observations require observedAt' })
  }
  if (observation.freshness === 'SNAPSHOT' && !observation.source.capturedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'capturedAt'], message: 'SNAPSHOT observations require capturedAt' })
  }
  if (observation.freshness === 'UNKNOWN' && !observation.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'UNKNOWN observations require a reason' })
  }
  if (observation.changedFiles.state === 'KNOWN' && !observation.changedFiles.sourceRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changedFiles', 'sourceRef'], message: 'KNOWN changed files require sourceRef' })
  }
  if (observation.changedFiles.state !== 'KNOWN' && observation.changedFiles.paths.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['changedFiles', 'paths'], message: 'unknown changed files cannot carry paths' })
  }
})

export function parseProgrammeOrchestrationObservation(input) {
  const parsed = ProgrammeOrchestrationObservationSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  }
}
