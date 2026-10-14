// @req FR-045, FR-284 — managed local paths retain portable relative identity.
// @spec SDD-023, SDD-113, SEC-007, ADR-016 D3/D8
// @tested tests/unit/fr045-path-security.test.js
import { describe, expect, it } from 'vitest'
import {
  assertSameWindowsVolume,
  LocalPathSecurityError,
  normalizeClientRelativePath,
  normalizeMountRoot,
  pathFlavorForRoot,
  resolveContainedPath,
} from '@/modules/project-manager/local-files/path-security'

describe('FR-045 local path security', () => {
  it('normalizes a Windows client-relative path into portable separators', () => {
    expect(normalizeClientRelativePath('Projects\\P-001\\Documents\\brief.pdf'))
      .toBe('Projects/P-001/Documents/brief.pdf')
    expect(normalizeClientRelativePath('Projects//P-001/./Documents//brief.pdf'))
      .toBe('Projects/P-001/Documents/brief.pdf')
  })

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['../outside.txt', 'traversal'],
    ['Projects/../../outside.txt', 'nested traversal'],
    ['/etc/passwd', 'POSIX absolute'],
    ['\\Windows\\win.ini', 'Windows rooted'],
    ['C:\\workspace\\file.txt', 'drive absolute'],
    ['C:file.txt', 'drive relative'],
    ['\\\\server\\share\\file.txt', 'UNC'],
    ['//server/share/file.txt', 'slash UNC'],
    ['\\\\?\\C:\\workspace\\file.txt', 'extended Windows path'],
  ])('rejects %s (%s)', (input) => {
    expect(() => normalizeClientRelativePath(input)).toThrow(LocalPathSecurityError)
  })

  it('resolves only a lexical descendant of the explicit Windows mount root', async () => {
    await expect(resolveContainedPath({
      mountRoot: 'D:\\zuri-workspace\\client-01',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
      realpath: async (candidate) => candidate,
    })).resolves.toEqual({
      relativePath: 'Projects/P-001/Documents/brief.pdf',
      absolutePath: 'D:\\zuri-workspace\\client-01\\Projects\\P-001\\Documents\\brief.pdf',
    })
  })

  it('retains Windows drive and UNC roots while rejecting ambiguous rooted forms', () => {
    expect(normalizeMountRoot('D:\\zuri-workspace\\client-01')).toBe('D:\\zuri-workspace\\client-01')
    expect(pathFlavorForRoot('\\\\server\\share\\workspace')).toBe('windows')
    expect(normalizeMountRoot('/tmp/zuri-workspace')).toBe('/tmp/zuri-workspace')
    expect(pathFlavorForRoot('/tmp/zuri-workspace')).toBe('posix')

    expect(() => normalizeMountRoot('\\root')).toThrow(LocalPathSecurityError)
    expect(() => normalizeMountRoot('C:relative')).toThrow(LocalPathSecurityError)
    expect(() => normalizeMountRoot('\\\\server')).toThrow(LocalPathSecurityError)
  })

  it('retains case-insensitive Windows volume checks', () => {
    expect(() => assertSameWindowsVolume('C:\\stage\\asset.tmp', 'c:\\workspace\\asset.txt')).not.toThrow()
    expect(() => assertSameWindowsVolume('C:\\stage\\asset.tmp', 'D:\\workspace\\asset.txt'))
      .toThrow('staging and destination must be on the same volume')
  })

  it('fails closed when an injected final real path escapes through a reparse point', async () => {
    await expect(resolveContainedPath({
      mountRoot: 'D:\\zuri-workspace\\client-01',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
      realpath: async (candidate) => candidate.endsWith('client-01')
        ? candidate
        : 'D:\\outside\\brief.pdf',
    })).rejects.toThrow('final real path escapes mounted root')
  })

  it('treats POSIX real paths as case-sensitive when checking containment', async () => {
    await expect(resolveContainedPath({
      mountRoot: '/srv/Workspace',
      relativePath: 'docs/brief.pdf',
      realpath: async (candidate) => candidate === '/srv/Workspace'
        ? '/srv/Workspace'
        : '/srv/workspace/docs/brief.pdf',
    })).rejects.toThrow('final real path escapes mounted root')
  })
})
