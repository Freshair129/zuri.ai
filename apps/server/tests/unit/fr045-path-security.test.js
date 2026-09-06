// @req FR-045 — managed local paths retain portable relative identity.
// @spec SDD-023, SEC-007, ADR-016 D3/D8
// @tested tests/unit/fr045-path-security.test.js
import { describe, expect, it } from 'vitest'
import {
  LocalPathSecurityError,
  normalizeClientRelativePath,
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

  it('fails closed when an injected final real path escapes through a reparse point', async () => {
    await expect(resolveContainedPath({
      mountRoot: 'D:\\zuri-workspace\\client-01',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
      realpath: async (candidate) => candidate.endsWith('client-01')
        ? candidate
        : 'D:\\outside\\brief.pdf',
    })).rejects.toThrow('final real path escapes mounted root')
  })
})
