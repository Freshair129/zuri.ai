import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptTraceAnnotations, legacyRequirementIds } from '../../scripts/trace-annotations.mjs'
import { createDocumentIdentityResolver } from '../../../../tools/document-identity.mjs'

const identity = (namespace, id, revision = 'pin') => ({
  namespace,
  id,
  family: id.split('-')[0],
  revision,
  path: `docs/${id}.md`,
  blob: `${namespace}-${id}-${revision}`,
  sourceStatus: 'approved',
  disposition: 'retained',
  reviewStatus: 'not-reviewed',
})

const resolver = createDocumentIdentityResolver({
  identities: [
    identity('ZAI', 'FR-042'),
    identity('ZAI', 'ADR-017'),
    identity('ZAI', 'AC-042-003-01'),
    identity('ZNEXT', 'FR-042-003', 'next-pin'),
    identity('ZNEXT', 'FR-042', 'next-pin'),
    identity('edge', 'FR-004'),
  ],
  mappings: [{
    source: { namespace: 'ZAI', id: 'FR-042' },
    sourceRevision: 'pin',
    targets: [{ namespace: 'ZNEXT', id: 'FR-042-003' }],
    sourceDisposition: 'mapped',
    reviewStatus: 'approved-alias',
    provenance: [{ path: 'registry/crosswalk.csv', revision: 'next-pin', blob: 'b', sha256: 'h', row: 1, sourceDisposition: 'mapped' }],
  }],
})

test('legacy scanner accepts complete bare IDs but never leaks qualified or longer IDs', () => {
  const text = [
    '@req FR-042, NFR-003, BR-009',
    '@trace implements ZAI:FR-044',
    'ZNEXT:FR-045 ZNEXT::FR-046 legacy:FR-047 edge::FR-004',
    'FR-042-003 FR-048-extra XFR-049 _FR-050 FR-051. docs/FR-052.md FR-053.MD',
  ].join('\n')
  assert.deepEqual(legacyRequirementIds(text), ['FR-042', 'NFR-003', 'BR-009', 'FR-051'])
  assert.deepEqual(legacyRequirementIds('FR-234/SDD-100; FR-192/ADR-077'), ['FR-234', 'SDD-100', 'FR-192'])
})

test('trace adapter maps only exact current ZAI identities and preserves relation meaning', () => {
  const source = [
    '/** @trace implements ZAI:FR-042 */',
    '// @trace decided_by ZAI:ADR-017',
    '// @trace verifies ZAI:FR-042, ZAI:AC-042-003-01',
    '// @trace implements ZNEXT:FR-042-003',
    '// @trace implements FR-042-003',
    '// @trace specified_by edge::FR-004',
  ].join('\n')
  const result = adaptTraceAnnotations(source, { resolveIdentity: resolver.resolveIdentity })
  assert.deepEqual(result.req, ['FR-042'])
  assert.deepEqual(result.spec, ['ZAI:ADR-017'])
  assert.deepEqual(result.verifiedRequirements, ['ZAI:FR-042', 'ZAI:AC-042-003-01'])
  assert.deepEqual(result.findings.map(({ code }) => code), [
    'NON_CANONICAL_TRACE_IDENTITY',
    'UNQUALIFIED_TRACE_IDENTITY',
    'NON_CANONICAL_TRACE_IDENTITY',
  ])
})

test('unresolved ZAI identities and unsupported relations produce findings with no edges', () => {
  const result = adaptTraceAnnotations([
    '// @trace implements ZAI:FR-999',
    '// @trace owns ZAI:FR-042',
  ].join('\n'), { resolveIdentity: resolver.resolveIdentity })
  assert.deepEqual(result.req, [])
  assert.deepEqual(result.findings.map(({ code }) => code), [
    'IDENTITY_NOT_FOUND',
    'UNSUPPORTED_TRACE_RELATION',
  ])
})

test('qualified and versioned targets are never partially parsed as bare IDs', () => {
  for (const input of [
    'ZNEXT:FR-042',
    'ZNEXT::FR-042',
    'legacy:FR-042',
    'edge::FR-004',
    'FR-042-003',
  ]) {
    assert.deepEqual(legacyRequirementIds(input), [], input)
  }
})
