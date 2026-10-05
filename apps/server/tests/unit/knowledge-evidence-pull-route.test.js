// @req FR-110 — the evidence-pull route fails closed as "unavailable" (503)
//   when the MSP transport cannot be built: absent (ZURI_MSP_COMMAND unset) or
//   misconfigured (an HTTP-mode secret file unreadable or empty). The answer
//   names the variable, never the file path or its contents, and nothing is
//   pulled. Review of #578, finding 1: the misconfigured case answered 500.
// @spec ADR-068 D1, ADR-050 D3
// @tested tests/unit/knowledge-evidence-pull-route.test.js
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer } from '../factories/viewer'

const { pullKnowledgeStageEvidence, resolveRequestViewer } = vi.hoisted(() => ({
  pullKnowledgeStageEvidence: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/platform/integrations/core/knowledge-evidence-importer', () => ({ pullKnowledgeStageEvidence }))

const { POST } = await import('@/app/api/pipelines/knowledge/evidence/pull/route')

const send = () => POST(new Request('http://local/api/pipelines/knowledge/evidence/pull', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scope: { portfolioId: 'p' } }),
}))

let directory

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(makeOperatorViewer())
  directory = mkdtempSync(path.join(tmpdir(), 'zuri-evidence-pull-'))
  vi.stubEnv('ZURI_MSP_COMMAND', process.execPath)
  vi.stubEnv('ZURI_MSP_ARGS', '[]')
  vi.stubEnv('MSP_GKS_TRANSPORT', 'http')
  vi.stubEnv('MSP_GKS_HTTP_URL', 'http://gks-http:8787')
  vi.stubEnv('MSP_GKS_PIPELINE_CREDENTIAL_FILE', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('POST /api/pipelines/knowledge/evidence/pull — MSP transport unavailable', () => {
  it('answers 503, as for an absent MSP, when an HTTP-mode secret file cannot be read', async () => {
    const missing = path.join(directory, 'missing-relay-credential')
    vi.stubEnv('GKS_MSP_RELAY_CREDENTIAL_FILE', missing)
    const res = await send()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ error: 'GKS_MSP_RELAY_CREDENTIAL_FILE could not be read' })
    expect(JSON.stringify(body)).not.toContain(directory)
    expect(pullKnowledgeStageEvidence).not.toHaveBeenCalled()
  })

  it('answers 503 when an HTTP-mode secret file is empty', async () => {
    const empty = path.join(directory, 'relay-credential')
    writeFileSync(empty, '  \n', { mode: 0o600 })
    vi.stubEnv('GKS_MSP_RELAY_CREDENTIAL_FILE', empty)
    const res = await send()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ error: 'GKS_MSP_RELAY_CREDENTIAL_FILE is empty' })
    expect(JSON.stringify(body)).not.toContain(directory)
    expect(pullKnowledgeStageEvidence).not.toHaveBeenCalled()
  })

  it('still answers 503 when the transport is not configured at all', async () => {
    vi.stubEnv('ZURI_MSP_COMMAND', '')
    const res = await send()
    expect(res.status).toBe(503)
    expect(pullKnowledgeStageEvidence).not.toHaveBeenCalled()
  })
})
