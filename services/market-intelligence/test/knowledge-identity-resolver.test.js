import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createKnowledgeIdentityResolver } from '../src/index.js'

function reader(records) {
  const calls = []
  return { calls, async query(request) { calls.push(request); return { records } } }
}

test('uses only the registered product_search query, scoped to the trusted Business', async () => {
  const port = reader([])
  await createKnowledgeIdentityResolver({ reader: port, businessId: 'business-a' })({ candidate: { title: 'Rice', businessId: 'business-evil' } })
  assert.deepEqual(port.calls, [{ businessId: 'business-a', queryId: 'product_search', params: { term: 'Rice' }, limit: 5 }])
})

test('exactly one exact match resolves; several matches stay PARTIAL', async () => {
  const one = await createKnowledgeIdentityResolver({ reader: reader([{ knowledge_id: 'k1', name: 'Rice' }]), businessId: 'b' })({ candidate: { title: 'rice' } })
  assert.equal(one.status, 'RESOLVED')
  assert.equal(one.canonicalProductRef, 'gks:business-knowledge:k1')

  const two = await createKnowledgeIdentityResolver({
    reader: reader([{ knowledge_id: 'k1', name: 'Rice' }, { knowledge_id: 'k2', name: 'Rice' }]),
    businessId: 'b',
  })({ candidate: { title: 'Rice' } })
  assert.equal(two.status, 'PARTIAL')
  assert.equal(two.canonicalProductRef, null)
})

test('no Business or no search term is UNRESOLVED without querying', async () => {
  const port = reader([{ knowledge_id: 'k1', name: 'Rice' }])
  assert.equal((await createKnowledgeIdentityResolver({ reader: port, businessId: null })({ candidate: { title: 'Rice' } })).status, 'UNRESOLVED')
  assert.equal((await createKnowledgeIdentityResolver({ reader: port, businessId: 'b' })({ candidate: {} })).status, 'UNRESOLVED')
  assert.equal(port.calls.length, 0)
})

test('a reader failure propagates instead of reading as "not found"', async () => {
  const failing = { async query() { throw new Error('knowledge unavailable') } }
  await assert.rejects(
    createKnowledgeIdentityResolver({ reader: failing, businessId: 'b' })({ candidate: { title: 'Rice' } }),
    /knowledge unavailable/,
  )
})
