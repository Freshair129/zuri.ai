import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeClusterDirectory, stopCluster } from '../helpers/embedded-postgres.js'

// @req FR-149, FR-150 — the PostgreSQL suite's teardown stops the disposable
// cluster and then removes its temp directory with retries; a directory Windows
// still holds (EBUSY, the #593 tests (1/4) failure) is left behind with a warning
// and never fails a green run, while a postmaster that will not stop still does.
// @spec ADR-057
// @tested tests/unit/embedded-postgres-cleanup.test.js

const busy = () => Object.assign(new Error('EBUSY: resource busy or locked, rmdir'), { code: 'EBUSY' })
const noSleep = async () => {}

describe('removeClusterDirectory', () => {
  it('retries with backoff while the directory is busy, then removes it', async () => {
    const rm = vi.fn()
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce(undefined)
    const sleep = vi.fn(noSleep)
    const warn = vi.fn()
    await expect(removeClusterDirectory('C:/tmp/zuri-pg-x', { rm, sleep, warn })).resolves.toBe(true)
    expect(rm).toHaveBeenCalledTimes(3)
    expect(rm).toHaveBeenCalledWith('C:/tmp/zuri-pg-x', { recursive: true, force: true })
    expect(sleep.mock.calls.map(([ms]) => ms)).toStrictEqual([100, 200])
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns and resolves, never rejects, when the directory stays locked', async () => {
    const rm = vi.fn().mockRejectedValue(busy())
    const sleep = vi.fn(noSleep)
    const warn = vi.fn()
    await expect(removeClusterDirectory('C:/tmp/zuri-pg-y', { rm, sleep, warn, attempts: 5 })).resolves.toBe(false)
    expect(rm).toHaveBeenCalledTimes(5)
    expect(sleep.mock.calls.map(([ms]) => ms)).toStrictEqual([100, 200, 400, 800])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('zuri-pg-y')
    expect(warn.mock.calls[0][0]).toContain('EBUSY')
  })

  it('caps the backoff delay', async () => {
    const sleep = vi.fn(noSleep)
    await removeClusterDirectory('r', { rm: vi.fn().mockRejectedValue(busy()), sleep, warn: vi.fn(), attempts: 8 })
    expect(sleep.mock.calls.map(([ms]) => ms)).toStrictEqual([100, 200, 400, 800, 1600, 2000, 2000])
  })

  it('does not retry an error that is not a lock, and still only warns', async () => {
    const rm = vi.fn().mockRejectedValue(Object.assign(new Error('bad path'), { code: 'EINVAL' }))
    const warn = vi.fn()
    await expect(removeClusterDirectory('r', { rm, sleep: noSleep, warn })).resolves.toBe(false)
    expect(rm).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('stopCluster', () => {
  const roots = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  const cluster = (pidFile) => {
    const root = mkdtempSync(path.join(tmpdir(), 'zuri-pg-unit-'))
    roots.push(root)
    const data = path.join(root, 'data')
    mkdirSync(data)
    if (pidFile) writeFileSync(path.join(data, 'postmaster.pid'), `${pidFile}\n${data}\n`)
    return { root, data }
  }

  it('stops the postmaster, waits for it to exit, and survives EBUSY on the first removals', async () => {
    const { root, data } = cluster(424242)
    const run = vi.fn()
    let checks = 0
    const alive = vi.fn(() => { checks += 1; return checks < 3 })
    const rm = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce(undefined)
    const warn = vi.fn()
    const remove = dir => removeClusterDirectory(dir, { rm, sleep: noSleep, warn })
    await expect(stopCluster({ root, data, pgCtl: 'pg_ctl', run, alive, sleep: noSleep, remove })).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60'])
    expect(alive).toHaveBeenCalledWith(424242)
    expect(alive).toHaveBeenCalledTimes(3)
    expect(rm).toHaveBeenCalledTimes(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to an immediate stop when the fast stop fails', async () => {
    const { root, data } = cluster(424243)
    const run = vi.fn().mockImplementationOnce(() => { throw new Error('pg_ctl: server does not shut down') })
    const remove = vi.fn(async () => true)
    await stopCluster({ root, data, pgCtl: 'pg_ctl', run, alive: () => false, sleep: noSleep, remove })
    expect(run.mock.calls.map(([, args]) => args[4])).toStrictEqual(['fast', 'immediate'])
    expect(remove).toHaveBeenCalledWith(root)
  })

  it('throws, and leaves the directory, when the postmaster is still running', async () => {
    const { root, data } = cluster(424244)
    const remove = vi.fn(async () => true)
    await expect(stopCluster({ root, data, pgCtl: 'pg_ctl', run: vi.fn(), alive: () => true, sleep: noSleep,
      exitTimeoutMs: 0, remove })).rejects.toThrow('EMBEDDED_POSTGRES_STOP_FAILED')
    expect(remove).not.toHaveBeenCalled()
  })

  it('skips pg_ctl when no server was started and still removes the directory', async () => {
    const { root, data } = cluster(null)
    const run = vi.fn()
    const remove = vi.fn(async () => true)
    await stopCluster({ root, data, pgCtl: 'pg_ctl', run, alive: () => true, sleep: noSleep, remove })
    expect(run).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith(root)
  })

  it('removes the real directory with the default remover once the cluster is down', async () => {
    const { root, data } = cluster(null)
    await stopCluster({ root, data, pgCtl: 'pg_ctl', run: vi.fn() })
    expect(existsSync(root)).toBe(false)
  })
})
