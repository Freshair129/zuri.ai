import assert from 'node:assert/strict'
import test from 'node:test'
import { maskExpectedViewerAssertions } from '../../apps/server/scripts/viewer-fixture-scan.mjs'

const roleLiteral = /\brole:\s*['"](OWNER|MEMBER|DEV)['"]/
const viewerField = /visibleBusinessIds|ownedBusinessIds|domainsByBusinessId|visibleDomains|isPlatform/

function scannerWouldFlag(source) {
  const lines = source.split('\n')
  return lines.some((line, index) => roleLiteral.test(line)
    && viewerField.test(lines.slice(Math.max(0, index - 10), index + 11).join('\n')))
}

test('keeps a hand-built viewer literal visible to the existing heuristic', () => {
  const source = "const viewer = { role: 'OWNER', visibleBusinessIds: ['business-1'] }"

  assert.equal(maskExpectedViewerAssertions(source), source)
  assert.equal(scannerWouldFlag(maskExpectedViewerAssertions(source)), true)
})

test('masks only a direct flat expected object while preserving line count and width', () => {
  const source = "expect(viewer).toMatchObject({ role: 'MEMBER', isPlatform: false, isOperator: false })\nexpect(viewer.role).toEqual('MEMBER')"
  const masked = maskExpectedViewerAssertions(source)

  assert.equal(masked.split('\n').length, source.split('\n').length)
  assert.equal(masked.split('\n')[0].length, source.split('\n')[0].length)
  assert.equal(scannerWouldFlag(masked), false)
  assert.equal(masked.split('\n')[1], source.split('\n')[1])
})

test('supports only the direct equality matcher forms used by viewer expectations', () => {
  for (const matcher of ['toMatchObject', 'toEqual', 'toStrictEqual']) {
    const source = `expect(viewer).${matcher}({ role: 'MEMBER', isPlatform: false })`
    assert.equal(scannerWouldFlag(maskExpectedViewerAssertions(source)), false)
  }
})

test('does not mask a viewer object passed as an actual function input', () => {
  const source = "expect(resolveViewer({ viewer: { role: 'OWNER', visibleBusinessIds: [] } })).toBeTruthy()"

  assert.equal(maskExpectedViewerAssertions(source), source)
  assert.equal(scannerWouldFlag(source), true)
})

test('does not mask adjacent hand-built code on the assertion line', () => {
  const source = "const viewer = { role: 'OWNER', visibleBusinessIds: [] }; expect(viewer).toEqual({ role: 'MEMBER' })"

  assert.equal(maskExpectedViewerAssertions(source), source)
  assert.equal(scannerWouldFlag(source), true)
})

test('leaves nested, dynamic, and multiline expected objects unchanged', () => {
  const nested = "expect(viewer).toEqual({ role: 'MEMBER', scope: { isPlatform: false } })"
  const dynamic = "expect(viewer).toEqual({ role: currentRole, isPlatform: false })"
  const multiline = "expect(viewer).toEqual({\n  role: 'MEMBER',\n  isPlatform: false,\n})"

  assert.equal(maskExpectedViewerAssertions(nested), nested)
  assert.equal(maskExpectedViewerAssertions(dynamic), dynamic)
  assert.equal(maskExpectedViewerAssertions(multiline), multiline)
  assert.equal(scannerWouldFlag(multiline), true)
})
