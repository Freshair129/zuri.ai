// @req FR-292 — private durable operation-owned exact-byte custody.
// @spec ADR-115
// @tested tests/integration/managed-blob-recovery-custody.test.js
import { constants } from 'node:fs'
import { mkdir, open, lstat, realpath, unlink, link } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { recoveryError } from './managed-blob-recovery-contract'

const idPattern = /^[a-f0-9-]{36}$/
// Configuration is supplied by the trusted server composition, never by a body.
// Directory permissions/Windows ACL qualification remains an activation gate.
export function createRecoverySpool(dataDirectory) {
  async function location(id) {
    if (!path.isAbsolute(dataDirectory || '') || !idPattern.test(id)) throw recoveryError(503)
    const root = path.join(dataDirectory, 'managed-blob-recovery-private')
    await mkdir(root, { recursive: true, mode: 0o700 })
    if ((await lstat(root)).isSymbolicLink() || path.resolve(await realpath(root)) !== path.resolve(root)) throw recoveryError(503)
    if (process.platform !== 'win32' && ((await lstat(root)).mode & 0o077)) throw recoveryError(503)
    return path.join(root, id)
  }
  const read = async (id, descriptor) => {
    const file = await open(await location(id), constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== descriptor.byteLength) throw recoveryError(409)
      const bytes = Buffer.alloc(descriptor.byteLength)
      let position = 0
      while (position < bytes.length) {
        const { bytesRead } = await file.read(bytes, position, bytes.length - position, position)
        if (!bytesRead) throw recoveryError(409)
        position += bytesRead
      }
      if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) throw recoveryError(409)
      return bytes
    } finally { await file.close() }
  }
  return Object.freeze({
    async write(id, descriptor, chunks, { deadline, commit, signal }) {
      const destination = await location(id), temporary = destination + '.upload'
      const file = await open(temporary, 'wx', 0o600)
      let complete = false, timer, iterator, onAbort
      const expired = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(recoveryError(410)), Math.max(0, deadline - Date.now()))
        onAbort = () => reject(recoveryError(410))
        signal?.addEventListener('abort', onAbort, { once: true })
      })
      try {
        const hash = createHash('sha256'); let size = 0
        if (!chunks || typeof chunks === 'string' || !(chunks[Symbol.asyncIterator] || chunks[Symbol.iterator])) throw recoveryError()
        iterator = chunks[Symbol.asyncIterator]?.() || chunks[Symbol.iterator]()
        for (;;) {
          if (Date.now() >= deadline || signal?.aborted) throw recoveryError(410)
          const next = await Promise.race([Promise.resolve(iterator.next()), expired])
          if (next.done) break
          const chunk = next.value
          if (!(chunk instanceof Uint8Array)) throw recoveryError()
          if (chunk.byteLength > descriptor.byteLength - size) throw recoveryError(413)
          await file.writeFile(chunk); hash.update(chunk); size += chunk.byteLength
        }
        if (size !== descriptor.byteLength || hash.digest('hex') !== descriptor.sha256) throw recoveryError()
        await file.sync(); await file.close()
        // The caller holds the DB claim/fence while promoting. A late stream
        // cannot create a finalized file after cleanup invalidates its epoch.
        const result = await commit(async () => { await link(temporary, destination) })
        complete = true
        return result
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (!complete && typeof iterator?.return === 'function') Promise.resolve(iterator.return()).catch(() => {})
        await file.close().catch(() => {})
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
    },
    read,
    async remove(id) {
      const target = await location(id)
      for (const exact of [target, target + '.upload']) {
        try { await unlink(exact) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    },
  })
}
