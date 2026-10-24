// @req FR-173, FR-254 — UI withdrawal uses the current immutable source version.
// @spec ADR-072, ADR-073
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useCallback: (callback) => callback,
    useEffect: vi.fn(),
    useMemo: (factory) => factory(),
    useRef: (current) => ({ current }),
    useState: (initial) => [initial, vi.fn()],
  }
})

vi.mock('@/context/ScopeContext', () => ({
  useScope: () => ({ currentBusiness: { id: 'business-a', name: 'Business A' }, shell: {} }),
}))

vi.mock('@/modules/project-manager/components/useApi', () => ({
  api: apiMock,
  useFetch: () => ({ data: { assets: [] }, loading: false, error: null, reload: vi.fn() }),
  LoadingCard: () => null,
}))

import KnowledgeDocumentsView from '@/modules/knowledge/ui/KnowledgeDocumentsView'

globalThis.React = React

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (node.props && predicate(node)) return node
  return findElement(node.props?.children, predicate)
}

function buildWithdrawButton(item, overrides = {}) {
  const view = KnowledgeDocumentsView({ initialTab: 'queue' })
  const queuePanel = findElement(view, (element) => element.type?.name === 'QueueTabPanel')
  if (!queuePanel) throw new Error('Knowledge Documents view did not render the queue panel')
  const panel = queuePanel.type({
    ...queuePanel.props,
    admissions: { data: { items: [item] }, loading: false, error: null },
    onReload: overrides.onReload || vi.fn(),
    onWithdrawSuccess: overrides.onWithdrawSuccess || vi.fn(),
    onError: overrides.onError || vi.fn(),
  })
  const button = findElement(panel, (element) => element.props?.['data-testid'] === `withdraw-${item.source.id}`)
  if (!button) throw new Error('Queue panel did not render a withdraw button')
  return button
}

function buildRetryButton(item, overrides = {}) {
  const view = KnowledgeDocumentsView({ initialTab: 'queue' })
  const queuePanel = findElement(view, (element) => element.type?.name === 'QueueTabPanel')
  if (!queuePanel) throw new Error('Knowledge Documents view did not render the queue panel')
  const panel = queuePanel.type({
    ...queuePanel.props,
    admissions: { data: { items: [item] }, loading: false, error: null },
    onReload: overrides.onReload || vi.fn(),
    onWithdrawSuccess: vi.fn(),
    onError: overrides.onError || vi.fn(),
  })
  return findElement(panel, (element) => element.props?.['data-testid'] === `retry-${item.id}`)
}

describe('Knowledge Documents source withdrawal', () => {
  let confirmMock

  beforeEach(() => {
    apiMock.mockReset()
    confirmMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('window', { confirm: confirmMock })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends source.version even when the ingestion revision differs', async () => {
    apiMock.mockResolvedValue({ status: 'WITHDRAWN' })
    const item = { id: 'ingestion-a', revision: 2, status: 'PUBLISHED', source: { id: 'source-a', version: 7, title: 'Document A' } }
    const onWithdrawSuccess = vi.fn()
    const button = buildWithdrawButton(item, { onWithdrawSuccess })

    await button.props.onClick()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/knowledge/sources/source-a', {
      method: 'DELETE', body: { expectedVersion: 7 },
    })
    expect(onWithdrawSuccess).toHaveBeenCalledWith('source-a')
  })

  it.each([undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses a missing or invalid source version (%s) without DELETE', async (version) => {
    const onError = vi.fn()
    const item = { id: 'ingestion-a', revision: 4, status: 'PUBLISHED', source: { id: 'source-a', version } }
    const button = buildWithdrawButton(item, { onError })

    await button.props.onClick()

    expect(apiMock).not.toHaveBeenCalled()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('version is unavailable'))
  })

  it('does not DELETE when the user cancels confirmation', async () => {
    confirmMock.mockReturnValue(false)
    const onWithdrawSuccess = vi.fn()
    const button = buildWithdrawButton({
      id: 'ingestion-a', revision: 3, status: 'PUBLISHED', source: { id: 'source-a', version: 8, title: 'Document A' },
    }, { onWithdrawSuccess })

    await button.props.onClick()

    expect(apiMock).not.toHaveBeenCalled()
    expect(onWithdrawSuccess).not.toHaveBeenCalled()
  })

  it('shows a source CAS conflict and refreshes once without retrying DELETE', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('source version changed'), { status: 409 }))
    const onError = vi.fn()
    const onReload = vi.fn()
    const onWithdrawSuccess = vi.fn()
    const button = buildWithdrawButton({
      id: 'ingestion-a', revision: 2, status: 'PUBLISHED', source: { id: 'source-a', version: 9, title: 'Document A' },
    }, { onError, onReload, onWithdrawSuccess })

    await button.props.onClick()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/knowledge/sources/source-a', {
      method: 'DELETE', body: { expectedVersion: 9 },
    })
    expect(onError).toHaveBeenCalledWith('source version changed')
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onWithdrawSuccess).not.toHaveBeenCalled()
  })
})

describe('Knowledge Documents benchmark retry', () => {
  beforeEach(() => apiMock.mockReset())

  it('shows retry only when the server marks the failed admission eligible and posts an idempotency key', async () => {
    const item = { id: 'admission-a', status: 'FAILED', retryAvailable: true }
    const onReload = vi.fn()
    apiMock.mockResolvedValue({ status: 'QUEUED' })
    const button = buildRetryButton(item, { onReload })

    expect(button).not.toBeNull()
    await button.props.onClick()

    expect(apiMock).toHaveBeenCalledTimes(1)
    const [path, options] = apiMock.mock.calls[0]
    expect(path).toBe('/api/knowledge/ingestions/admission-a/replay')
    expect(options.method).toBe('POST')
    expect(options.body.idempotencyKey).toEqual(expect.stringContaining('knowledge-ui-retry:admission-a:'))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('reuses the same idempotency key after an uncertain request failure', async () => {
    apiMock.mockRejectedValueOnce(new Error('reply lost')).mockResolvedValueOnce({ status: 'QUEUED' })
    const button = buildRetryButton({ id: 'admission-a', status: 'FAILED', retryAvailable: true })

    await button.props.onClick()
    await button.props.onClick()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(apiMock.mock.calls[1][1].body.idempotencyKey).toBe(apiMock.mock.calls[0][1].body.idempotencyKey)
  })

  it('does not show retry for failed admissions without server-confirmed eligibility', () => {
    expect(buildRetryButton({ id: 'admission-a', status: 'FAILED', retryAvailable: false })).toBeNull()
    expect(buildRetryButton({ id: 'admission-b', status: 'QUEUED', retryAvailable: true })).toBeNull()
  })
})
