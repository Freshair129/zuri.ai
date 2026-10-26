// @spec ADR-115 — bounded, regular-file payload I/O; exclusive output writes.
// @tested tests/node/compact-package.test.mjs
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CompactError } from './manifest.mjs'

export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const stableJson = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item
}, 2) + '\n'
export async function regularFile(root, relative, maxBytes = Infinity) {
  try {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(s => !s || s === '.' || s === '..')) throw 0
    const target = path.resolve(root, relative), rel = path.relative(path.resolve(root), target)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw 0
    let cursor = path.resolve(root), info = await lstat(cursor)
    if (!info.isDirectory() || info.isSymbolicLink()) throw 0
    const segments = relative.split('/')
    for (let i = 0; i < segments.length; i++) {
      cursor = path.join(cursor, segments[i]); info = await lstat(cursor)
      if (info.isSymbolicLink() || (i < segments.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > maxBytes)) throw 0
    }
    return { filename: target, info }
  } catch { throw new CompactError('COMPACT_SOURCE_INVALID') }
}
export async function openRegular(root, relative, maxBytes = Infinity) {
  const { filename, info } = await regularFile(root, relative, maxBytes)
  let handle
  try {
    handle = await open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    const actual = await handle.stat()
    if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== info.size || actual.mtimeMs !== info.mtimeMs) throw 0
    return handle
  } catch { await handle?.close(); throw new CompactError('COMPACT_SOURCE_INVALID') }
}
export async function bytes(root, relative, maxBytes = 64 * 1024 * 1024) {
  const handle = await openRegular(root, relative, maxBytes)
  try { return await handle.readFile() } finally { await handle.close() }
}
export async function json(root, relative, maxBytes) {
  try { return JSON.parse((await bytes(root, relative, maxBytes)).toString('utf8')) }
  catch (error) { if (error instanceof CompactError) throw error; throw new CompactError('COMPACT_JSON_INVALID') }
}
export async function hashFile(root, relative) {
  const handle = await openRegular(root, relative), h = createHash('sha256')
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) h.update(chunk); return h.digest('hex') }
  finally { await handle.close() }
}
export async function destination(root, relative) {
  let cursor = root
  for (const segment of relative.split('/').slice(0, -1)) {
    cursor = path.join(cursor, segment)
    try { await mkdir(cursor) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const info = await lstat(cursor)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CompactError('COMPACT_OUTPUT_INVALID')
  }
  return path.join(root, relative)
}
export async function writeExclusive(root, relative, content) {
  await writeFile(await destination(root, relative), content, { flag: 'wx', mode: 0o644 })
}
export async function listFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }), files = []
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new CompactError('COMPACT_SOURCE_INVALID')
    if (entry.isDirectory()) files.push(...await listFiles(root, rel))
    else if (entry.isFile()) files.push(rel)
    else throw new CompactError('COMPACT_SOURCE_INVALID')
    if (files.length > 100000) throw new CompactError('COMPACT_SOURCE_INVALID')
  }
  return files.sort()
}
