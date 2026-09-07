import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMspStdioTransport, createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'

// @req FR-057 — the zuri-ai → MSP transport: MSP's own NDJSON JSON-RPC framing
// over a spawned process, one process per call, tool errors surfaced verbatim.
// @spec ADR-068 D1, ADR-043 D2
// @tested tests/unit/msp-stdio-transport.test.js

const echoServer = path.resolve('tests/fixtures/ndjson-echo-server.mjs')

describe('createMspStdioTransport', () => {
  it('speaks initialize → tools/call and returns the structuredContent of the tool', async () => {
    const transport = createMspStdioTransport({ command: process.execPath, args: [echoServer] })
    const result = await transport('msp_knowledge_evidence_export', { scope: { portfolioId: 'p' }, since_cursor: 3 })
    expect(result).toEqual({ echoed: 'msp_knowledge_evidence_export', args: { scope: { portfolioId: 'p' }, since_cursor: 3 } })
  })

  it('surfaces a tool-level error with the tool’s own text, so a fail-closed MSP reason is readable', async () => {
    const transport = createMspStdioTransport({ command: process.execPath, args: [echoServer] })
    await expect(transport('fail', {})).rejects.toMatchObject({ code: 'MSP_TOOL_ERROR', status: 503, message: expect.stringContaining('gks_provider_unconfigured') })
  })

  it('fails closed on a process that exits without answering', async () => {
    const transport = createMspStdioTransport({ command: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 5_000 })
    await expect(transport('anything', {})).rejects.toMatchObject({ code: 'MSP_TRANSPORT_UNAVAILABLE', message: expect.stringContaining('exited with code 3') })
  })

  it('is built from deployment configuration only when ZURI_MSP_COMMAND is set', () => {
    expect(createMspTransportFromEnvironment({})).toBeNull()
    expect(createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: '   ' })).toBeNull()
    expect(typeof createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: 'node', ZURI_MSP_ARGS: '["server.mjs"]' })).toBe('function')
    expect(() => createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: 'node', ZURI_MSP_ARGS: 'not-json' })).toThrow(/JSON array/)
    expect(() => createMspTransportFromEnvironment({ ZURI_MSP_COMMAND: 'node', ZURI_MSP_ARGS: '[1]' })).toThrow(/JSON array/)
  })
})
