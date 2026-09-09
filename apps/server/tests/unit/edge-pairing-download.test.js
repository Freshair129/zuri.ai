import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { edgePairingDownload } from '@/modules/identity/edge-pairing-download'
// @req FR-144 — native fixture is the actual Console export, not a parallel parser assumption.
// @spec SEC-025
describe('Console/Desktop pairing export',()=> {
 it('matches the fixture consumed by Rust',()=> {
  const fixture=JSON.parse(readFileSync('../edge/tests/fixtures/desktop-pairing-export.json','utf8'))
  expect(edgePairingDownload({
   credential:{deviceId:'DEV-TEST',createdAt:'2026-09-08T00:00:00.000Z'},
   key:'edgk_synthetic_test_credential',businessId:'synthetic-business',
   businessCode:'TEST',businessName:'Test Business',origin:'https://zuri.example',
  })).toEqual(fixture)
 })
})
