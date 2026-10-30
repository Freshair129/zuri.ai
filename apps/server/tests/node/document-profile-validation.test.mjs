import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const api = await import('../../scripts/document-profile-validation.mjs').catch(() => null)

const records = [
  {
    entry: { id: 'FEAT-001', family: 'FEAT', path: 'docs/features/FEAT-001/feature.md' },
    record: { id: 'FEAT-001', family: 'FEAT', requirementKeys: ['FR-001'], cells: ['', 'FEAT-001', 'Example', 'FR-001', 'live'] },
    text: '',
  },
  {
    entry: { id: 'FR-001', family: 'FR', path: 'docs/features/FEAT-001/requirements/FR-001.md' },
    record: { id: 'FR-001', family: 'FR', featureId: 'FEAT-001', cells: ['', 'FR-001', 'Example requirement', '✅'] },
    text: '',
  },
  {
    entry: { id: 'FR-002', family: 'FR', path: 'docs/requirements/FR-002.md' },
    record: { id: 'FR-002', family: 'FR', cells: ['', 'FR-002', 'Standalone example', 'planned'] },
    text: '',
  },
]

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

const srs = `---
doc_type: domain-srs-view
domain_id: DOM-SALES
status: proposed
version: "0.1.0"
source_revision: "0123456789abcdef0123456789abcdef01234567"
relations:
  - type: references
    target: CHARTER.md
---

# SRS — Sales

## 1. Purpose and boundary
Domain charter: [Sales charter](CHARTER.md)

## 2. Process and capability map
| Verified process or capability | Canonical FEAT | Canonical FR records | Source evidence |
|---|---|---|---|
| Order capture | [FEAT-001](../../features/FEAT-001/feature.md) | [FR-001](../../features/FEAT-001/requirements/FR-001.md) | [Charter](CHARTER.md) |

## 3. Requirements index
| Canonical ID | Exact source path | Canonical lifecycle | Applicability or controlling decision |
|---|---|---|---|
| FR-001 | [docs/features/FEAT-001/requirements/FR-001.md](../../features/FEAT-001/requirements/FR-001.md) | current | [Charter](CHARTER.md) |

## 4. Domain and service contracts
- Domain-owned data and invariants: [Charter](CHARTER.md)

## 5. Acceptance and verification references
| Evidence question | Exact test or evidence path | Revision and result |
|---|---|---|
| Does the flow work? | [test](../../tests/order.test.mjs) | Not run |

## 6. Exclusions and unresolved conflicts
| Topic | Conflicting or excluded sources | Status and next authority |
|---|---|---|
| None identified | — | — |

## 7. Change history
| Version | Date | Source revision | Change |
|---|---|---|---|
| 0.1.0 | 2026-10-22 | 0123456789abcdef0123456789abcdef01234567 | Initial linked view |
`

test('documentation inventory compares registered names with the live direct filesystem', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  const result = api.compareDocumentationInventory({
    registeredRootFiles: ['README.md', 'PRODUCT.md'],
    registeredDirectories: ['domains', 'requirements'],
    actualRootFiles: ['README.md', 'PRODUCT.md', '.doc-graph.json', 'rogue.md'],
    actualDirectories: ['domains', 'requirements', 'stray'],
    generatedRootFiles: ['.doc-graph.json'],
  })
  assert.deepEqual(result, {
    missingRootFiles: [],
    unregisteredRootFiles: ['rogue.md'],
    missingDirectories: [],
    unregisteredDirectories: ['stray'],
  })
})

test('filesystem register parsers enumerate the documented direct root entries', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  const rootFiles = readFileSync(path.join(REPOSITORY_ROOT, 'docs/governance/ROOT-FILE-REGISTER.md'), 'utf8')
  const directories = readFileSync(path.join(REPOSITORY_ROOT, 'docs/governance/DOCS-DIRECTORY-REGISTER.md'), 'utf8')
  assert.equal(api.parseDirectRootFileRegister(rootFiles).length, 43)
  assert.equal(api.parseDirectDirectoryRegister(directories).length, 20)
})

test('domain SRS profile accepts exact canonical requirement links and source-backed membership', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  const result = api.validateDomainSrsView({
    relativePath: 'docs/domains/sales/SRS.md',
    body: srs.replace('doc_type: domain-srs-view', 'doc_type: "domain-srs-view"'),
    charterPath: 'docs/domains/sales/CHARTER.md',
    charterBody: '---\ndomain_id: DOM-SALES\ndomain: sales\n---\n# Sales',
    records,
  })
  assert.deepEqual(result.issues, [])
})

test('domain SRS profile rejects wrong source paths, lifecycle drift, and unregistered membership', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  const broken = srs
    .replace('requirements/FR-001.md](../../features/FEAT-001/requirements/FR-001.md)', 'requirements/FR-001.md](../../requirements/FR-002.md)')
    .replace('| FR-001 | [docs/features/FEAT-001/requirements/FR-001.md]', '| FR-001 | [docs/features/FEAT-001/requirements/FR-001.md]')
    .replace('| current | [Charter](CHARTER.md) |', '| planned | [Charter](CHARTER.md) |')
    .replace('[FR-001](../../features/FEAT-001/requirements/FR-001.md)', '[FR-002](../../requirements/FR-002.md)')
  const result = api.validateDomainSrsView({
    relativePath: 'docs/domains/sales/SRS.md',
    body: broken,
    charterPath: 'docs/domains/sales/CHARTER.md',
    charterBody: '---\ndomain_id: DOM-SALES\ndomain: sales\n---\n# Sales',
    records,
  })
  assert.ok(result.issues.some((issue) => issue.code === 'canonical-path'))
  assert.ok(result.issues.some((issue) => issue.code === 'source-lifecycle'))
  assert.ok(result.issues.some((issue) => issue.code === 'feat-membership'))
})

test('domain SRS requires a markdown link instead of a path-shaped plain-text value', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  const plainPath = srs.replace(
    '[docs/features/FEAT-001/requirements/FR-001.md](../../features/FEAT-001/requirements/FR-001.md)',
    'docs/features/FEAT-001/requirements/FR-001.md',
  )
  const result = api.validateDomainSrsView({
    relativePath: 'docs/domains/sales/SRS.md',
    body: plainPath,
    charterPath: 'docs/domains/sales/CHARTER.md',
    charterBody: '---\ndomain_id: DOM-SALES\ndomain: sales\n---\n# Sales',
    records,
  })
  assert.ok(result.issues.some((issue) => issue.code === 'canonical-link'))
})

test('an unassigned process row still requires every linked FR in the requirements index', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  const unassigned = srs
    .replace('[FEAT-001](../../features/FEAT-001/feature.md)', 'unassigned')
    .replace('| FR-001 | [docs/features/FEAT-001/requirements/FR-001.md](../../features/FEAT-001/requirements/FR-001.md) | current | [Charter](CHARTER.md) |\n', '')
  const result = api.validateDomainSrsView({
    relativePath: 'docs/domains/sales/SRS.md',
    body: unassigned,
    charterPath: 'docs/domains/sales/CHARTER.md',
    charterBody: '---\ndomain_id: DOM-SALES\ndomain: sales\n---\n# Sales',
    records,
  })
  assert.ok(result.issues.some((issue) => issue.code === 'requirements-index'))
})

test('legacy SRS without the profile marker is left outside the new profile checks', async () => {
  assert.ok(api, 'document-profile-validation.mjs must exist before these checks can run')
  assert.deepEqual(api.validateDomainSrsView({
    relativePath: 'docs/domains/sales/SRS.md',
    body: '# Existing SRS\nLegacy local requirements are preserved.',
    charterPath: 'docs/domains/sales/CHARTER.md',
    charterBody: '',
    records,
  }), { applicable: false, issues: [] })
})
