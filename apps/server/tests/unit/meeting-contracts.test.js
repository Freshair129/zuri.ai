import { describe, expect, it } from 'vitest'
import { zMeetingActionIntake, zMeetingRecordingIntake } from '@/modules/project-manager/import/meeting-contracts'

const trace = { correlationId: 'meeting-correlation-1', idempotencyKey: 'meeting-idempotency-1' }

describe('meeting intake contracts', () => {
  it('accepts the shared recording contract from either supported app', () => {
    const recording = {
      schemaVersion: 'meeting-recording-intake.v1',
      trace,
      source: { app: 'FUNG', userId: 'fung-user-1', recordingId: 'recording-1', capturedAt: '2026-09-22T10:00:00Z' },
      meeting: { meetingId: 'meeting-1', title: 'Weekly sync' },
      recording: { audioRef: 'local://recording-1.wav', mimeType: 'audio/wav', durationMs: 120000 },
    }
    expect(zMeetingRecordingIntake.parse(recording).source.app).toBe('FUNG')
    expect(zMeetingRecordingIntake.parse({ ...recording, source: { ...recording.source, app: 'LALIN_AI' } }).source.app).toBe('LALIN_AI')
  })

  it('accepts normalized action candidates without a product-specific task field', () => {
    const intake = {
      schemaVersion: 'meeting-action-intake.v1',
      trace,
      source: { app: 'LALIN_AI', userId: 'lalin-user-1' },
      scope: { workspaceCode: 'WS-BIZ-1', projectCode: 'PRJ-1' },
      meeting: { meetingId: 'meeting-1', recordingId: 'recording-1', transcriptRevision: 'rev-2' },
      actions: [{
        actionId: 'action-1',
        title: 'ส่งใบเสนอราคา',
        tags: ['follow-up', 'sales'],
        assignee: { sourceUserId: 'lalin-user-2', displayName: 'Member' },
        targetAt: '2026-09-30',
        confidence: 0.91,
        evidence: [{ type: 'TRANSCRIPT', ref: 'segment-12', quote: 'ส่งภายในวันศุกร์' }],
      }],
    }
    expect(zMeetingActionIntake.parse(intake).actions[0].title).toBe('ส่งใบเสนอราคา')
    expect(zMeetingActionIntake.safeParse({ ...intake, lalinTask: {} }).success).toBe(false)
  })

  it('rejects an unbound source app and arbitrary identity fields', () => {
    const base = {
      schemaVersion: 'meeting-action-intake.v1',
      trace,
      source: { app: 'FUNG', userId: 'fung-user-1' },
      scope: { workspaceCode: 'WS-BIZ-1' },
      meeting: { meetingId: 'meeting-1', recordingId: 'recording-1', transcriptRevision: 'rev-1' },
      actions: [{ actionId: 'action-1', title: 'Review' }],
    }
    expect(zMeetingActionIntake.safeParse({ ...base, source: { app: 'CAST', userId: 'x' } }).success).toBe(false)
    expect(zMeetingActionIntake.safeParse({ ...base, personId: 'person-1' }).success).toBe(false)
  })
})
