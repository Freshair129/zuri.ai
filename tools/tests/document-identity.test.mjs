import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DocumentIdentityError,
  createDocumentIdentityResolver,
  formatQualifiedIdentity,
  parseQualifiedIdentity,
  validateIdentityManifests,
} from '../document-identity.mjs'

const declaration = (namespace, id, revision, extra = {}) => ({
  namespace,
  id,
  family: id.split('-')[0],
  revision,
  path: `docs/${id}.md`,
  blob: `${namespace}-${revision}-${id}`,
  sha256: `sha256-${namespace}-${revision}-${id}`,
  declarationKind: 'requirement',
  sourceStatus: 'approved',
  disposition: 'retained',
  reviewStatus: 'not-reviewed',
  ...extra,
})

const provenance = (revision, targetId, row = 7) => ({
  path: 'registry/crosswalk/requirements.csv',
  revision,
  blob: `crosswalk-${revision}`,
  sha256: `sha256-${revision}`,
  row,
  targetId,
  sourceDisposition: 'equivalent-candidate',
})

const fixtures = () => {
  const identities = [
    declaration('ZAI', 'FR-042', 'zai-base'),
    declaration('ZAI', 'FR-042', 'zai-prior', { path: 'archive/FR-042.md', blob: 'old-fr-042' }),
    declaration('ZNEXT', 'FR-042', 'znext-pin'),
    declaration('ZNEXT', 'FR-042', 'znext-prior', { path: 'archive/FR-042.md', blob: 'old-znext-fr-042' }),
    declaration('ZAI', 'FR-888', 'zai-base'),
    declaration('ZNEXT', 'FR-888', 'znext-pin'),
    declaration('ZNEXT', 'FR-889', 'znext-pin'),
    declaration('ZNEXT', 'FR-890', 'znext-prior'),
    declaration('edge', 'FR-004', 'edge-pin'),
  ]
  const mappings = [
    {
      source: { namespace: 'ZAI', id: 'FR-042' },
      sourceRevision: 'zai-base',
      sourceLocator: { path: 'docs/FR-042.md', blob: 'ZAI-zai-base-FR-042', sha256: 'sha256-ZAI-zai-base-FR-042' },
      targetRevision: 'znext-pin',
      targets: [{ namespace: 'ZNEXT', id: 'FR-042' }],
      sourceDisposition: 'mapped',
      reviewStatus: 'approved-alias',
      provenance: [provenance('znext-pin', 'FR-042', 7), provenance('znext-pin', 'FR-042', 8)],
    },
    {
      source: { namespace: 'ZAI', id: 'FR-888' },
      sourceRevision: 'zai-base',
      sourceLocator: { path: 'docs/FR-888.md', blob: 'ZAI-zai-base-FR-888', sha256: 'sha256-ZAI-zai-base-FR-888' },
      targetRevision: 'znext-pin',
      targets: [{ namespace: 'ZNEXT', id: 'FR-888' }, { namespace: 'ZNEXT', id: 'FR-889' }],
      sourceDisposition: 'split',
      reviewStatus: 'approved-alias',
      provenance: [provenance('znext-pin', 'FR-888', 9), provenance('znext-pin', 'FR-889', 10)],
    },
  ]
  return { identities, mappings }
}

test('qualified forms preserve the three namespaces and their syntax', () => {
  assert.deepEqual(parseQualifiedIdentity('ZAI:FR-042'), { namespace: 'ZAI', id: 'FR-042' })
  assert.deepEqual(parseQualifiedIdentity('ZNEXT:FR-042-003'), { namespace: 'ZNEXT', id: 'FR-042-003' })
  assert.deepEqual(parseQualifiedIdentity('edge::FR-004'), { namespace: 'edge', id: 'FR-004' })
  assert.equal(formatQualifiedIdentity({ namespace: 'edge', id: 'FR-004' }), 'edge::FR-004')
  assert.throws(() => parseQualifiedIdentity('edge:FR-004'), { code: 'INVALID_IDENTITY_REFERENCE' })
})

test('exact resolution preserves source revision, path and blob', () => {
  const resolver = createDocumentIdentityResolver(fixtures())
  const found = resolver.resolveIdentity('ZAI:FR-042', { revision: 'zai-base' })
  assert.equal(found.namespace, 'ZAI')
  assert.equal(found.revision, 'zai-base')
  assert.equal(found.path, 'docs/FR-042.md')
  assert.equal(found.blob, 'ZAI-zai-base-FR-042')
  assert.equal(resolver.resolveIdentity('edge::FR-004').namespace, 'edge')
})

test('bare IDs resolve only when unique; namespace and revision collisions fail closed', () => {
  const resolver = createDocumentIdentityResolver(fixtures())
  assert.throws(() => resolver.resolveIdentity('FR-042'), { code: 'AMBIGUOUS_IDENTITY' })
  assert.throws(() => resolver.resolveIdentity('ZAI:FR-042'), { code: 'AMBIGUOUS_IDENTITY' })
  assert.equal(resolver.resolveIdentity('ZAI:FR-042', { revision: 'zai-prior' }).path, 'archive/FR-042.md')
  assert.equal(resolver.resolveIdentity('FR-004').namespace, 'edge')
  assert.throws(() => resolver.resolveIdentity('FR-777'), { code: 'IDENTITY_NOT_FOUND' })
})

test('approved one-to-one crosswalk resolves only the pinned ZNEXT revision to its ZAI declaration', () => {
  const resolver = createDocumentIdentityResolver(fixtures())
  const result = resolver.resolveCanonicalIdentity('ZNEXT:FR-042', { revision: 'znext-pin' })
  assert.equal(result.source.namespace, 'ZNEXT')
  assert.equal(result.source.revision, 'znext-pin')
  assert.equal(result.canonical.namespace, 'ZAI')
  assert.equal(result.canonical.revision, 'zai-base')
  assert.equal(result.canonical.path, 'docs/FR-042.md')
  assert.equal(result.provenance.length, 2)
  assert.throws(
    () => resolver.resolveCanonicalIdentity('ZNEXT:FR-042', { revision: 'znext-prior' }),
    { code: 'IDENTITY_ALIAS_REVISION_MISMATCH' },
  )
})

test('split, merge, unreviewed and competing crosswalks never become aliases', () => {
  const { identities, mappings } = fixtures()
  const resolver = createDocumentIdentityResolver({
    identities: [
      ...identities,
      declaration('ZAI', 'FR-891', 'zai-base'),
      declaration('ZNEXT', 'FR-891', 'znext-pin'),
      declaration('ZAI', 'FR-892', 'zai-base'),
    ],
    mappings: [
      ...mappings,
      {
        source: { namespace: 'ZAI', id: 'FR-891' },
        sourceRevision: 'zai-base',
        sourceLocator: { path: 'docs/FR-891.md', blob: 'ZAI-zai-base-FR-891', sha256: 'sha256-ZAI-zai-base-FR-891' },
        targetRevision: 'znext-pin',
        targets: [{ namespace: 'ZNEXT', id: 'FR-891' }],
        sourceDisposition: 'mapped',
        reviewStatus: 'not-reviewed',
        provenance: [provenance('znext-pin', 'FR-891', 11)],
      },
      {
        source: { namespace: 'ZAI', id: 'FR-892' },
        sourceRevision: 'zai-base',
        sourceLocator: { path: 'docs/FR-892.md', blob: 'ZAI-zai-base-FR-892', sha256: 'sha256-ZAI-zai-base-FR-892' },
        targetRevision: 'znext-pin',
        targets: [{ namespace: 'ZNEXT', id: 'FR-042' }],
        sourceDisposition: 'mapped',
        reviewStatus: 'not-reviewed',
        provenance: [provenance('znext-pin', 'FR-042', 12)],
      },
    ],
  })
  assert.throws(
    () => resolver.resolveCanonicalIdentity('ZNEXT:FR-888', { revision: 'znext-pin' }),
    { code: 'IDENTITY_ALIAS_NOT_ONE_TO_ONE' },
  )
  assert.throws(
    () => resolver.resolveCanonicalIdentity('ZNEXT:FR-891', { revision: 'znext-pin' }),
    { code: 'IDENTITY_ALIAS_NOT_APPROVED' },
  )
  assert.throws(
    () => resolver.resolveCanonicalIdentity('ZNEXT:FR-042', { revision: 'znext-pin' }),
    { code: 'IDENTITY_ALIAS_AMBIGUOUS' },
  )
})

test('manifest validation checks source revision, endpoints, duplicate declarations and row provenance', () => {
  const { identities, mappings } = fixtures()
  const errors = validateIdentityManifests({ identities, mappings })
  assert.ok(errors.some(error => error.code === 'INVALID_APPROVED_ALIAS'))
  const mergeErrors = validateIdentityManifests({
    identities: [...identities, declaration('ZAI', 'FR-892', 'zai-base')],
    mappings: [...mappings, {
      source: { namespace: 'ZAI', id: 'FR-892' },
      sourceRevision: 'zai-base',
      targets: [{ namespace: 'ZNEXT', id: 'FR-042' }],
      sourceDisposition: 'mapped',
      reviewStatus: 'not-reviewed',
      provenance: [provenance('znext-pin', 11)],
    }],
  })
  assert.ok(mergeErrors.some(error => error.code === 'ALIAS_TARGET_HAS_MULTIPLE_SOURCES'))

  const invalid = validateIdentityManifests({
    identities: [declaration('ZAI', 'FR-001', 'base'), declaration('ZAI', 'FR-001', 'base')],
    mappings: [{
      source: { namespace: 'ZAI', id: 'FR-404' },
      sourceRevision: 'missing-revision',
      sourceLocator: { path: 'docs/FR-404.md', blob: 'missing', sha256: 'missing' },
      targetRevision: 'next',
      targets: [{ namespace: 'ZNEXT', id: 'FR-404' }],
      sourceDisposition: 'mapped',
      reviewStatus: 'not-reviewed',
      provenance: [{ path: 'x.csv', revision: '', blob: '', sha256: '', row: 0, targetId: '', sourceDisposition: '' }],
    }],
  })
  assert.ok(invalid.some(error => error.code === 'DUPLICATE_IDENTITY_DECLARATION'))
  assert.ok(invalid.some(error => error.code === 'MAPPING_SOURCE_NOT_DECLARED'))
  assert.ok(invalid.some(error => error.code === 'MAPPING_TARGET_NOT_DECLARED'))
  assert.ok(invalid.some(error => error.code === 'INVALID_MAPPING_PROVENANCE'))
})

test('CLI validates manifest envelopes from an explicit repository root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'document-identity-check-'))
  try {
    const manifestDir = path.join(root, 'registry', 'document-reintegration')
    mkdirSync(manifestDir, { recursive: true })
    const zai = declaration('ZAI', 'FR-100', 'zai-pin')
    const znext = declaration('ZNEXT', 'FR-200', 'znext-pin')
    const mapping = {
      source: { namespace: 'ZAI', id: 'FR-100' },
      sourceRevision: 'zai-pin',
      sourceLocator: { path: zai.path, blob: zai.blob, sha256: zai.sha256 },
      targetRevision: 'znext-pin',
      targets: [{ namespace: 'ZNEXT', id: 'FR-200' }],
      sourceDisposition: 'candidate',
      reviewStatus: 'not-reviewed',
      provenance: [{ path: 'registry/crosswalk.csv', revision: 'znext-pin', blob: 'csv-blob', sha256: 'csv-hash', row: 2, targetId: 'FR-200', sourceDisposition: 'candidate' }],
    }
    writeFileSync(path.join(manifestDir, 'identities.json'), JSON.stringify({ identities: [zai, znext] }))
    writeFileSync(path.join(manifestDir, 'mappings.json'), JSON.stringify({ mappings: [mapping] }))
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'tools', 'document-identity.mjs'), '--check', '--root', root], {
      cwd: path.join(repoRoot, 'apps', 'server'),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /2 declarations, 1 mappings/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('identity errors retain a stable code and useful details', () => {
  const resolver = createDocumentIdentityResolver(fixtures())
  assert.throws(() => resolver.resolveIdentity('ZAI:FR-042'), error => {
    assert.ok(error instanceof DocumentIdentityError)
    assert.equal(error.code, 'AMBIGUOUS_IDENTITY')
    assert.equal(error.details.candidates.length, 2)
    return true
  })
})
