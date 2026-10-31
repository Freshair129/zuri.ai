// @req FR-294 — reviewed verifier/schema/archive and actual producer ZIP provenance.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {it,expect} from 'vitest'
const sha=b=>createHash('sha256').update(b).digest('hex')
it('binds the exact offline verifier and fixture bytes to the reviewed producer',()=>{
 const base=new URL('../../vendor/office-design/',import.meta.url),p=JSON.parse(readFileSync(new URL('provenance.json',base)))
 expect(p.revision).toBe('b4e2d8edec9d8dbad32573d860cff3a6a27efbbd');expect(p.threeVersion).toBe('0.180.0')
 for(const [name,key]of [['verifier.mjs','bundleSha256'],['archive.mjs','archiveSha256'],['schema.json','schemaSha256']])expect(sha(readFileSync(new URL(name,base)))).toBe(p[key])
 const fixtures=new URL('../fixtures/office-design/',import.meta.url),f=JSON.parse(readFileSync(new URL('provenance.json',fixtures)))
 for(const name of ['stock','custom'])expect(sha(gunzipSync(readFileSync(new URL(`${name}.zip.gz`,fixtures))))).toBe(f[name].archiveSha256)
})
