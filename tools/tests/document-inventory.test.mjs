import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildManifests, PINNED_REVISIONS, validateManifests } from '../document-inventory.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeRepo(parent, name, files) {
  const repo = path.join(parent, name);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.name', 'Inventory Test');
  git(repo, 'config', 'user.email', 'inventory-test@example.invalid');
  for (const [filePath, body] of Object.entries(files)) {
    const destination = path.join(repo, ...filePath.split('/'));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, body, 'utf8');
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'inventory fixture');
  return { repo, revision: git(repo, 'rev-parse', 'HEAD') };
}

function makeFixture(parent, { missingTarget = false } = {}) {
  const zaiIds = {
    'FR-100': { family: 'FR', source: 'docs/PRD.md', status: 'current' },
    'FR-200': { family: 'FR', source: 'docs/PRD.md', status: 'retired' },
    'ZV2-CR-001': { family: 'ZV2-CR', source: 'docs/changes/ZV2-CR-001.md', status: 'current' },
  };
  const zai = makeRepo(parent, 'zai', {
    'docs/.id-ledger.json': JSON.stringify({ roster: Object.keys(zaiIds), ids: zaiIds }),
    'docs/PRD.md': '# Source identity fixture\n',
    'docs/changes/ZV2-CR-001.md': '# Governed change record\n',
    'docs/change-requests/CR-001-proposal.md': '# Proposal only\n',
    'apps/edge/docs/edge-spec.md': '# Edge requirement fixture\n',
    'apps/edge/docs/.doc-graph.json': JSON.stringify({
      nodes: [
        { type: 'requirement', id: 'req:AC-100-001-01', label: 'AC-100-001-01', path: 'docs/edge-spec.md', status: 'current' },
        { type: 'requirement', id: 'req:RAG-FR-001', label: 'RAG-FR-001', path: 'docs/edge-spec.md', status: 'retired' },
      ],
    }),
  });
  const firstTarget = missingTarget ? 'FR-999-999' : 'FR-001-001';
  const znext = makeRepo(parent, 'znext', {
    'docs/features/FEAT-001-example/feature.md': [
      '---', 'id: FEAT-001', 'status: draft', '---', '', '# FEAT-001 — Example', '',
    ].join('\n'),
    'docs/features/FEAT-001-example/requirements/FR-001-001-first.md': [
      '# FR-001-001 — First target', '', '- AC-001-001-01 — Given a fixture, when read, then it is stable.', '',
    ].join('\n'),
    'docs/features/FEAT-001-example/requirements/FR-001-002-second.md': '# FR-001-002 — Second target\n',
    'docs/features/FEAT-001-example/design.md': '- **Components:** CMP-001 — fixture component.\n',
    'docs/change-requests/CR-001-proposal.md': '# Imported proposal path is not ZAI intake\n',
    'registry/domains.yaml': 'domains:\n  - code: CRM\n',
    'registry/crosswalk/X-001.csv': [
      'legacy_id,new_id,disposition,note',
      `FR-100,${firstTarget},split,"first, duplicate-safe row"`,
      'FR-100,FR-001-001,migrated,duplicate target',
      'FR-100,FR-001-002,split,second target',
      'FR-200,,retired,blank target',
      '',
    ].join('\n'),
    'tools/validate-docs.mjs': 'export {};\n',
    'AGENTS.md': '# Tooling input fixture\n',
  });
  return { zai, znext };
}

test('builds deterministically from pinned Git trees, preserving split, duplicate, and blank rows', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'document-inventory-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const { zai, znext } = makeFixture(temp);
  const options = { zaiRepo: zai.repo, znextRepo: znext.repo, zaiRevision: zai.revision, znextRevision: znext.revision, enforcePins: false };
  const first = buildManifests(options);
  const second = buildManifests(options);
  assert.deepEqual(first, second);
  const checked = validateManifests(first, { enforcePins: false });
  assert.equal(checked.zaiIdentities, 3);
  assert.equal(checked.crosswalkRows, 4);
  assert.equal(checked.edgeIdentities, 2);

  const split = first.mappings.mappings.find((mapping) => mapping.source.id === 'FR-100');
  assert.equal(split.sourceDisposition, 'mixed');
  assert.deepEqual(split.targets.map((target) => target.id), ['FR-001-001', 'FR-001-002']);
  assert.equal(split.provenance.length, 3);
  assert.equal(split.reviewStatus, 'not-reviewed');
  assert.ok(split.provenance.every((row) => row.revision === znext.revision));
  assert.ok(split.provenance.every((row) => /^[0-9a-f]{64}$/.test(row.sha256)));

  const blank = first.mappings.mappings.find((mapping) => mapping.source.id === 'FR-200');
  assert.equal(blank.sourceDisposition, 'retired');
  assert.deepEqual(blank.targets, []);
  assert.equal(blank.provenance[0].targetId, null);

  const bareCr = first.intake.intake.find((entry) => entry.path.endsWith('CR-001-proposal.md'));
  assert.ok(bareCr);
  assert.equal(bareCr.identity, null);
  assert.equal(bareCr.disposition, 'proposal-intake');
  assert.equal(first.identities.identities.some((identity) => identity.id === 'ZV2-CR-001' && identity.namespace === 'ZAI'), true);
  assert.equal(first.identities.identities.some((identity) => identity.id === 'AC-100-001-01' && identity.namespace === 'edge'), true);
  assert.equal(first.identities.identities.some((identity) => identity.id === 'RAG-FR-001' && identity.namespace === 'edge' && identity.family === 'RAG-FR'), true);
  assert.equal(first.identities.identities.some((identity) => identity.id === 'CMP-001' && identity.namespace === 'ZNEXT'), true);
});

test('requires the pinned revisions in normal operation', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'document-inventory-pin-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const { zai, znext } = makeFixture(temp);
  assert.equal(PINNED_REVISIONS.ZAI, 'a34ceaf79c112e02b1bcfdbf0a84122d835b002e');
  assert.equal(PINNED_REVISIONS.ZNEXT, '8f3fa178f05567ae2c3863896d5a99cf6fd96d49');
  assert.throws(() => buildManifests({ zaiRepo: zai.repo, znextRepo: znext.repo, zaiRevision: '0'.repeat(40) }), /pinned to/);
});

test('rejects crosswalk targets without a declaration at the pinned target revision', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'document-inventory-target-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const { zai, znext } = makeFixture(temp, { missingTarget: true });
  assert.throws(() => buildManifests({
    zaiRepo: zai.repo,
    znextRepo: znext.repo,
    zaiRevision: zai.revision,
    znextRevision: znext.revision,
    enforcePins: false,
  }), /Crosswalk target lacks a ZNEXT declaration/);
});

test('rejects duplicate source mapping records and target/cardinality disagreement', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'document-inventory-cardinality-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const { zai, znext } = makeFixture(temp);
  const manifests = buildManifests({
    zaiRepo: zai.repo,
    znextRepo: znext.repo,
    zaiRevision: zai.revision,
    znextRevision: znext.revision,
    enforcePins: false,
  });
  assert.doesNotThrow(() => validateManifests(manifests, { enforcePins: false }));

  const duplicate = structuredClone(manifests);
  duplicate.mappings.mappings.splice(1, 0, structuredClone(duplicate.mappings.mappings[0]));
  assert.throws(() => validateManifests(duplicate, { enforcePins: false }), /Duplicate mapping source/);

  const conflict = structuredClone(manifests);
  conflict.mappings.mappings.find((mapping) => mapping.source.id === 'FR-100').targets.pop();
  assert.throws(() => validateManifests(conflict, { enforcePins: false }), /Mapping target cardinality differs/);
});
