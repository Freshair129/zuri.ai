import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ current: null }))

vi.mock('react', () => ({
  createElement: (...args) => ({ args }),
  useCallback: (callback, deps) => hooks.current.useCallback(callback, deps),
  useEffect: (effect, deps) => hooks.current.useEffect(effect, deps),
  useRef: (initial) => hooks.current.useRef(initial),
  useState: (initial) => hooks.current.useState(initial),
}))

const { useFetch } = await import('@/modules/project-manager/components/useApi')

function sameDeps(left, right) {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

class HookHarness {
  slots = []
  effects = []
  cursor = 0
  pendingEffects = []
  args = []
  latest = null

  useRef(initial) {
    const index = this.cursor++
    this.slots[index] ||= { kind: 'ref', value: { current: initial } }
    return this.slots[index].value
  }

  useState(initial) {
    const index = this.cursor++
    this.slots[index] ||= { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    const slot = this.slots[index]
    return [slot.value, (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next
    }]
  }

  useCallback(callback, deps) {
    const index = this.cursor++
    const current = this.slots[index]
    if (current && sameDeps(current.deps, deps)) return current.value
    this.slots[index] = { kind: 'callback', deps: [...deps], value: callback }
    return callback
  }

  useEffect(effect, deps) {
    const index = this.cursor++
    const current = this.effects[index]
    if (!current || !sameDeps(current.deps, deps)) {
      this.pendingEffects.push({ index, effect, deps: [...deps], previous: current })
    }
  }

  render(...args) {
    this.args = args
    this.cursor = 0
    this.pendingEffects = []
    hooks.current = this
    this.latest = useFetch(...args)
    for (const pending of this.pendingEffects) {
      pending.previous?.cleanup?.()
      const cleanup = pending.effect()
      this.effects[pending.index] = { deps: pending.deps, cleanup }
    }
    return this.latest
  }

  refresh() {
    return this.render(...this.args)
  }

  dispose() {
    for (const effect of this.effects) effect?.cleanup?.()
    hooks.current = null
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function queuedFetch() {
  const requests = new Map()
  const fetch = vi.fn((path) => {
    const request = deferred()
    const pending = requests.get(path) || []
    pending.push(request)
    requests.set(path, pending)
    return request.promise
  })
  return { fetch, request: (path, index = 0) => requests.get(path)?.[index] }
}

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

async function flushPromises(harness) {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  return harness.refresh()
}

afterEach(() => {
  hooks.current?.dispose()
  vi.unstubAllGlobals()
})

describe('useFetch request scope', () => {
  it('ignores a late response from the previous scope after the newer scope resolves', async () => {
    const pending = queuedFetch()
    vi.stubGlobal('fetch', pending.fetch)
    const harness = new HookHarness()

    harness.render('/api/thread/a', ['business-a:thread-a'], 'business-a:thread-a')
    const oldRequest = pending.request('/api/thread/a')
    harness.render('/api/thread/b', ['business-b:thread-b'], 'business-b:thread-b')
    const newRequest = pending.request('/api/thread/b')
    expect(harness.refresh()).toMatchObject({ data: null, loading: true, error: null })

    newRequest.resolve(response({ thread: 'B', consentStatus: 'GRANTED' }))
    await flushPromises(harness)
    expect(harness.latest).toMatchObject({ data: { thread: 'B', consentStatus: 'GRANTED' }, loading: false, error: null })

    oldRequest.resolve(response({ thread: 'A', consentStatus: 'DECLINED' }))
    await flushPromises(harness)
    expect(harness.latest).toMatchObject({ data: { thread: 'B', consentStatus: 'GRANTED' }, loading: false, error: null })
  })

  it('clears old data and errors on scope changes but retains same-scope data during reload', async () => {
    const pending = queuedFetch()
    vi.stubGlobal('fetch', pending.fetch)
    const harness = new HookHarness()

    harness.render('/api/thread/a', ['scope-a'], 'scope-a')
    pending.request('/api/thread/a').resolve(response({ thread: 'A' }))
    await flushPromises(harness)
    expect(harness.latest.data).toEqual({ thread: 'A' })

    harness.render('/api/thread/b', ['scope-b'], 'scope-b')
    expect(harness.refresh()).toMatchObject({ data: null, loading: true, error: null })
    pending.request('/api/thread/b').resolve(response({ thread: 'B' }, false))
    await flushPromises(harness)
    expect(harness.latest).toMatchObject({ data: null, loading: false, error: 'Request failed (500)' })

    harness.render('/api/thread/c', ['scope-c'], 'scope-c')
    expect(harness.refresh()).toMatchObject({ data: null, loading: true, error: null })
    pending.request('/api/thread/c').resolve(response({ thread: 'C' }))
    await flushPromises(harness)
    expect(harness.latest.data).toEqual({ thread: 'C' })

    const reload = harness.latest.reload()
    expect(harness.refresh()).toMatchObject({ data: { thread: 'C' }, loading: true, error: null })
    pending.request('/api/thread/c', 1).resolve(response({ thread: 'C refreshed' }))
    await reload
    expect(harness.refresh()).toMatchObject({ data: { thread: 'C refreshed' }, loading: false, error: null })
  })

  it('keeps the existing path-scoped behavior for callers that omit the scope key', async () => {
    const pending = queuedFetch()
    vi.stubGlobal('fetch', pending.fetch)
    const harness = new HookHarness()

    harness.render('/api/default')
    pending.request('/api/default').resolve(response({ value: 'initial' }))
    await flushPromises(harness)
    expect(harness.latest).toMatchObject({ data: { value: 'initial' }, loading: false, error: null })

    const reload = harness.latest.reload()
    pending.request('/api/default', 1).reject(new Error('network unavailable'))
    await reload
    expect(harness.refresh()).toMatchObject({ data: null, loading: false, error: 'network unavailable' })
  })
})
