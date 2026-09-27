import { describe, expect, it } from 'vitest'
import { createLinePushReportNotifier } from '@/modules/marketing/insights/infrastructure/line-push-report-notifier'

const failure = {
  syncRunId: 'fx-sync-1',
  failureKey: 'TRANSIENT_ERROR',
  reasonCode: 'TRANSIENT_ERROR',
  brandDisplayName: 'FX INFRESH Page A',
  brandSlug: 'infresh',
  window: { from: '2026-09-01', to: '2026-09-28' },
}

function fakeTransport(pushImpl) {
  const calls = []
  return {
    calls,
    async push(args) {
      calls.push(args)
      return pushImpl ? pushImpl(args) : { status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'fx-req-1', code: null }
    },
  }
}

describe('LINE push report notifier', () => {
  it('is honestly unavailable with no credential reference', () => {
    const port = createLinePushReportNotifier({ recipients: [{ kind: 'user', id: 'fx-line-user-1' }], transport: fakeTransport() })
    expect(port).toMatchObject({ capability: 'ReportNotificationPort', available: false, reasonCode: 'CREDENTIAL_REF_NOT_CONFIGURED' })
  })

  it('is honestly unavailable with no approved recipients', () => {
    const port = createLinePushReportNotifier({ credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN', recipients: [], transport: fakeTransport() })
    expect(port).toMatchObject({ available: false, reasonCode: 'RECIPIENT_NOT_CONFIGURED' })
  })

  it('treats an all-invalid recipient list the same as no recipients', () => {
    const port = createLinePushReportNotifier({
      credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN',
      recipients: [{ kind: 'channel', id: 'fx-line-channel-1' }, { kind: 'user', id: '' }],
      transport: fakeTransport(),
    })
    expect(port.reasonCode).toBe('RECIPIENT_NOT_CONFIGURED')
  })

  it('refuses to compose without an injected transport', () => {
    expect(() => createLinePushReportNotifier({
      credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN',
      recipients: [{ kind: 'user', id: 'fx-line-user-1' }],
    })).toThrow(/transport/)
  })

  it('pushes one message per recipient through the injected transport, each with its own retry key', async () => {
    const transport = fakeTransport()
    const port = createLinePushReportNotifier({
      credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN',
      recipients: [{ kind: 'user', id: 'fx-line-user-1' }, { kind: 'group', id: 'fx-line-group-1' }],
      quotaNote: 'shared OA monthly quota',
      transport,
    })
    expect(port.available).toBe(true)
    const result = await port.invoke(failure)
    expect(result).toMatchObject({ sent: 2, failed: 0, quotaNote: 'shared OA monthly quota' })
    expect(result.retryKey).toBeUndefined()
    expect(transport.calls).toHaveLength(2)
    for (const call of transport.calls) {
      expect(call.credentialRef).toBe('env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN')
      expect(call.messages).toEqual([{ type: 'text', text: expect.stringContaining('TRANSIENT_ERROR') }])
    }
    // Never touching a URL itself, and — the bug this guards against — never
    // reusing one LINE retry key across recipients: LINE checks
    // X-Line-Retry-Key per request, so a shared key would get every push
    // after the first rejected as a duplicate and only the first recipient
    // would ever be alerted.
    expect(transport.calls[0].retryKey).not.toBe(transport.calls[1].retryKey)
    expect(transport.calls[0].to).toBe('fx-line-user-1')
    expect(transport.calls[1].to).toBe('fx-line-group-1')
    expect(result.results.map((entry) => entry.retryKey)).toEqual([transport.calls[0].retryKey, transport.calls[1].retryKey])
  })

  it('derives the same retry key for the same recipient across repeated invocations, but a different one for a different failure', async () => {
    const transport = fakeTransport()
    const port = createLinePushReportNotifier({
      credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN',
      recipients: [{ kind: 'user', id: 'fx-line-user-1' }],
      transport,
    })
    await port.invoke(failure)
    await port.invoke(failure)
    expect(transport.calls[0].retryKey).toBe(transport.calls[1].retryKey)

    const otherFailure = { ...failure, syncRunId: 'fx-sync-2' }
    await port.invoke(otherFailure)
    expect(transport.calls[2].retryKey).not.toBe(transport.calls[0].retryKey)
  })

  it('reports a partial failure without throwing', async () => {
    let call = 0
    const transport = fakeTransport(() => {
      call += 1
      return call === 1
        ? { status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'fx-req-1', code: null }
        : { status: 'PERMANENT_FAILURE', httpStatus: 400, requestId: null, code: 'LINE_HTTP_400' }
    })
    const port = createLinePushReportNotifier({
      credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN',
      recipients: [{ kind: 'user', id: 'fx-line-user-1' }, { kind: 'user', id: 'fx-line-user-2' }],
      transport,
    })
    const result = await port.invoke(failure)
    expect(result).toMatchObject({ sent: 1, failed: 1 })
  })

  it('throws SOURCE_UNAVAILABLE when every recipient push fails', async () => {
    const transport = fakeTransport(() => ({ status: 'PERMANENT_FAILURE', httpStatus: 400, requestId: null, code: 'LINE_HTTP_400' }))
    const port = createLinePushReportNotifier({
      credentialRef: 'env:ZURI_INSIGHTS_LINE_CHANNEL_ACCESS_TOKEN',
      recipients: [{ kind: 'user', id: 'fx-line-user-1' }],
      transport,
    })
    await expect(port.invoke(failure)).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', status: 503 })
  })
})
