import { z } from 'zod'

// @req FR-069 — FUNG and Lalin AI meeting surfaces use one normalized intake
// contract; sourceApp is metadata, never a second product-specific payload.
// @spec BR-009, SEC-001, SEC-003 — recording and action candidates remain data
// until PM validates, previews and authorizes the write.
// @tested tests/unit/meeting-contracts.test.js

export const MEETING_SOURCE_APPS = Object.freeze(['FUNG', 'LALIN_AI'])

const zSourceApp = z.enum(MEETING_SOURCE_APPS)
const zDateOrDateTime = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
])
const zDateTime = z.string().datetime({ offset: true })

const zTrace = z.object({
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict()

const zRecordingSource = z.object({
  app: zSourceApp,
  userId: z.string().min(1),
  recordingId: z.string().min(1),
  capturedAt: zDateTime,
}).strict()

export const zMeetingRecordingIntake = z.object({
  schemaVersion: z.literal('meeting-recording-intake.v1'),
  trace: zTrace,
  source: zRecordingSource,
  meeting: z.object({
    meetingId: z.string().min(1),
    title: z.string().min(1).optional(),
    startedAt: zDateTime.optional(),
    endedAt: zDateTime.optional(),
  }).strict(),
  recording: z.object({
    audioRef: z.string().min(1),
    mimeType: z.string().min(1),
    durationMs: z.number().int().nonnegative().optional(),
    contentHash: z.string().min(1).optional(),
    transcriptRef: z.string().min(1).optional(),
  }).strict(),
  participants: z.array(z.object({
    sourceUserId: z.string().min(1),
    displayName: z.string().min(1).optional(),
  }).strict()).max(500).optional(),
}).strict()

const zEvidence = z.object({
  type: z.enum(['TRANSCRIPT', 'AUDIO', 'TIMESTAMP', 'QUOTE']),
  ref: z.string().min(1),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  quote: z.string().optional(),
}).strict()

const zAssigneeProposal = z.object({
  sourceUserId: z.string().min(1),
  displayName: z.string().min(1).optional(),
}).strict()

export const zMeetingActionIntake = z.object({
  schemaVersion: z.literal('meeting-action-intake.v1'),
  trace: zTrace,
  source: z.object({
    app: zSourceApp,
    userId: z.string().min(1),
  }).strict(),
  scope: z.object({
    workspaceCode: z.string().min(1),
    projectCode: z.string().min(1).optional(),
    workstreamCode: z.string().min(1).optional(),
  }).strict(),
  meeting: z.object({
    meetingId: z.string().min(1),
    recordingId: z.string().min(1),
    transcriptRevision: z.string().min(1),
    title: z.string().min(1).optional(),
  }).strict(),
  actions: z.array(z.object({
    actionId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    tags: z.array(z.string().min(1)).max(30).optional(),
    assignee: zAssigneeProposal.optional(),
    targetAt: zDateOrDateTime.optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.array(zEvidence).max(30).optional(),
  }).strict()).min(1).max(200),
}).strict()
