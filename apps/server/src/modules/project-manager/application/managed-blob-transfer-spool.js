// @req FR-293 — raw packages remain bounded, private and target-local.
// @spec ADR-115
// @tested tests/unit/managed-blob-transfer-spool.test.js
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, lstat, realpath, unlink, link } from 'node:fs/promises'
import path from 'node:path'

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const SHA = /^[a-f0-9]{64}$/
const refused = (status = 400) => Object.assign(new Error('Managed blob transfer refused'), { status })
const resolvedPathIdentity = value => {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? path.toNamespacedPath(resolved).toLowerCase() : resolved
}

export function createManagedBlobTransferSpool(dataDirectory) {
  async function location(id, artifact = 'package') {
    if (!path.isAbsolute(dataDirectory || '') || !ID.test(id)) throw refused(503)
    if (!['package', 'snapshot'].includes(artifact)) throw refused(503)
    const root = path.join(dataDirectory, 'managed-blob-transfer-private')
    await mkdir(root, { recursive: true, mode: 0o700 })
    const [rootStat, actualRoot, actualDataDirectory] = await Promise.all([
      lstat(root), realpath(root), realpath(dataDirectory),
    ])
    const expectedRoot = path.join(actualDataDirectory, 'managed-blob-transfer-private')
    if (rootStat.isSymbolicLink() || resolvedPathIdentity(actualRoot) !== resolvedPathIdentity(expectedRoot)) throw refused(503)
    if (process.platform !== 'win32' && ((await lstat(root)).mode & 0o077)) throw refused(503)
    return path.join(root, artifact === 'snapshot' ? `${id}.snapshot` : id)
  }

  return Object.freeze({
    async write(id, chunks, { maxBytes, deadline, signal, artifact = 'package', commit = callback => callback() } = {}) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isFinite(deadline)) throw refused()
      const destination = await location(id, artifact), temporary = destination + '.upload'
      const file = await open(temporary, 'wx', 0o600)
      let complete = false, timer, iterator, onAbort
      const expired = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(refused(410)), Math.max(0, deadline - Date.now()))
        onAbort = () => reject(refused(410))
        signal?.addEventListener('abort', onAbort, { once: true })
      })
      try {
        if (!chunks || typeof chunks === 'string' || !(chunks[Symbol.asyncIterator] || chunks[Symbol.iterator])) throw refused()
        iterator = chunks[Symbol.asyncIterator]?.() || chunks[Symbol.iterator]()
        const hash = createHash('sha256')
        let size = 0
        for (;;) {
          if (Date.now() >= deadline || signal?.aborted) throw refused(410)
          const next = await Promise.race([Promise.resolve(iterator.next()), expired])
          if (next.done) break
          if (!(next.value instanceof Uint8Array) || next.value.byteLength > maxBytes - size) throw refused(413)
          await file.writeFile(next.value)
          hash.update(next.value)
          size += next.value.byteLength
        }
        if (size <= 0) throw refused()
        const sha256 = hash.digest('hex')
        await file.sync()
        await file.close()
        await commit(async () => { await link(temporary, destination) })
        complete = true
        return { byteLength: size, sha256 }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (!complete && typeof iterator?.return === 'function') Promise.resolve(iterator.return()).catch(() => {})
        await file.close().catch(() => {})
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
    },
    async read(id, { byteLength, sha256, maxBytes = byteLength, artifact = 'package' } = {}) {
      if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || !Number.isSafeInteger(maxBytes)
        || byteLength > maxBytes || !SHA.test(sha256 || '')) throw refused()
      const file = await open(await location(id, artifact), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0))
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size !== byteLength || stat.size > maxBytes) throw refused(409)
        const bytes = Buffer.alloc(byteLength)
        let position = 0
        while (position < bytes.length) {
          const { bytesRead } = await file.read(bytes, position, bytes.length - position, position)
          if (!bytesRead) throw refused(409)
          position += bytesRead
        }
        if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw refused(409)
        return bytes
      } finally { await file.close() }
    },
    async remove(id) {
      const targets = await Promise.all(['package', 'snapshot'].map(artifact => location(id, artifact)))
      for (const target of targets.flatMap(value => [value, value + '.upload'])) {
        try { await unlink(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    },
    async removeArtifact(id, artifact) {
      const target = await location(id, artifact)
      for (const exact of [target, target + '.upload']) {
        try { await unlink(exact) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    },
  })
}
