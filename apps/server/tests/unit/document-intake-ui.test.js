import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-071 — Data Migration shows the server-filtered CloudSoTAgent staging
// monitor and an explicit not-configured state without raw document values.
// @spec docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md,
// BR-001, SEC-001, SEC-008
// @tested tests/unit/document-intake-ui.test.js

const view = readFileSync('src/modules/project-manager/views/execution/mode-bodies.jsx', 'utf8')
const route = readFileSync('src/app/api/ingest/documents/route.js', 'utf8')

describe('FR-071 document intake monitor UI contract', () => {
  it('loads the Business-scoped server monitor from the migration view', () => {
    expect(view).toContain("import { useFetch } from '../../components/useApi'")
    expect(view).toContain('/api/ingest/documents?businessId=')
    expect(view).toContain('workstream.project?.businessId')
    expect(view).toContain('CloudSoTAgent')
    expect(view).toContain('processingStatus')
  })

  it('renders an explicit not-configured state instead of pretending staging is live', () => {
    expect(view).toContain('Document intake connection not provisioned')
    expect(view).toContain('!data.configured')
    expect(view).toContain('ยังไม่มีเอกสารเข้าคิว staging')
  })

  it('keeps raw payload and source values outside the monitor UI contract', () => {
    expect(view).not.toContain('payloadJson')
    expect(view).not.toContain('sourceRef')
    expect(view).not.toContain('rawPayload')
  })

  it('lets the server resolve a monitor connection by Business while preserving trusted auth', () => {
    expect(route).toContain('businessId: z.string().min(1).optional()')
    expect(route).toContain('resolveRequestViewer')
    expect(route).toContain('listDocumentIntakeRecords')
    expect(route).toContain('connectionId or businessId is required')
  })
})
