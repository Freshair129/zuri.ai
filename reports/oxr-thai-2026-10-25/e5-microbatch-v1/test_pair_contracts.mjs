import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, canonicalQuery, samePinnedRuntime, sameResourceProfile } from './pair_contracts.mjs';

function queryRow(chunkOrdinal = 12) {
  return {
    id: 'pop1', doc: 'population', repetition: 1,
    response: { results: [{
      score: 0.75, document: 'population', zoneIds: ['row-1'],
      citation: { sourceId: 'experiment://source', chunkId: `parsed:chunk:${chunkOrdinal}`, contentHash: 'abc' },
      verifiedRange: { start: 10, end: 20 }, text: 'row text',
    }] },
  };
}

test('resource objects compare independently of key insertion order', () => {
  assert.equal(
    sameResourceProfile({ cpu: 2, network: 'none', memory: 6 }, { memory: 6, cpu: 2, network: 'none' }),
    true,
  );
  assert.equal(
    sameResourceProfile({ cpu: 2, network: 'none', memory: 6 }, { memory: 6, cpu: 4, network: 'none' }),
    false,
  );
});

test('paired runtime requires the same pinned image and model revision', () => {
  const profile = { pinnedImage: 'sha256:image', readonlyModelVolume: 'model-vol', modelDirectory: '/model/rev-a' };
  const runtime = { pins: { runtime: { modelRepository: 'repo/model', modelRevision: 'rev-a' }, profile: 'stdio' } };
  const reorderedRuntime = { pins: { profile: 'stdio', runtime: { modelRevision: 'rev-a', modelRepository: 'repo/model' } } };
  assert.equal(samePinnedRuntime(profile, { ...profile }, runtime, reorderedRuntime), true);
  assert.equal(samePinnedRuntime(profile, { ...profile, pinnedImage: 'sha256:other' }, runtime, reorderedRuntime), false);
  assert.equal(samePinnedRuntime(profile, { ...profile }, runtime, { pins: { ...runtime.pins, runtime: { ...runtime.pins.runtime, modelRevision: 'rev-b' } } }), false);
});

test('canonical retrieval identity detects changed chunk ordinal and preserves result order', () => {
  assert.notEqual(canonicalJson(canonicalQuery(queryRow(12))), canonicalJson(canonicalQuery(queryRow(13))));
  const two = queryRow(12);
  two.response.results.push({ ...two.response.results[0], citation: { ...two.response.results[0].citation, chunkId: 'parsed:chunk:13' } });
  const reversed = structuredClone(two);
  reversed.response.results.reverse();
  assert.notEqual(canonicalJson(canonicalQuery(two)), canonicalJson(canonicalQuery(reversed)));
});

test('canonical retrieval identity fails closed when source identity is absent', () => {
  const missing = queryRow();
  delete missing.response.results[0].citation.sourceId;
  assert.throws(() => canonicalQuery(missing), /stable source\/chunk\/document identity/);
});
