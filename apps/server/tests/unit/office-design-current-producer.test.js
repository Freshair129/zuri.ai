// @req FR-294 — exercise the current producer against the pinned Office design verifier.
// @tested tests/unit/office-design-current-producer.test.js
import {createHash} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {describe,it,expect} from 'vitest'
import {verifyOfficeArchive} from '@/modules/business/office-design/verify'
import {readHandoffArchive} from '../../vendor/office-design/archive.mjs'
import {handoffZip} from '../../vendor/office-design/verifier.mjs'

const fixtureUrl=name=>new URL(`../fixtures/office-design/${name}.zip.gz`,import.meta.url)
const readJson=url=>JSON.parse(readFileSync(url,'utf8'))
const stockFixture=()=>gunzipSync(readFileSync(fixtureUrl('stock')))
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
const ledgerUrl=new URL('../fixtures/office-design/current-producer.json',import.meta.url)
const pinUrl=new URL('../../vendor/office-design/provenance.json',import.meta.url)
const fixtureProvenanceUrl=new URL('../fixtures/office-design/provenance.json',import.meta.url)

function zipEntries(bytes){
 const end=bytes.length-22
 if(bytes.readUInt32LE(end)!==0x06054b50)throw new Error('ZIP end record not found')
 const count=bytes.readUInt16LE(end+10)
 let cursor=bytes.readUInt32LE(end+16)
 const entries=[]
 for(let index=0;index<count;index++){
  if(bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('ZIP central entry not found')
  const nameLength=bytes.readUInt16LE(cursor+28)
  const extraLength=bytes.readUInt16LE(cursor+30)
  const commentLength=bytes.readUInt16LE(cursor+32)
  const localOffset=bytes.readUInt32LE(cursor+42)
  entries.push({
   name:bytes.toString('utf8',cursor+46,cursor+46+nameLength),
   method:bytes.readUInt16LE(cursor+10),
   compressedSize:bytes.readUInt32LE(cursor+20),
   localOffset,
   dataOffset:localOffset+30+bytes.readUInt16LE(localOffset+26)+bytes.readUInt16LE(localOffset+28)
  })
  cursor+=46+nameLength+extraLength+commentLength
 }
 return entries
}

function flipStoredEntryByte(archive,entryName,relativeOffset){
 const entry=zipEntries(archive).find(candidate=>candidate.name===entryName)
 if(!entry||entry.method!==0||entry.compressedSize===0)throw new Error(`Expected a stored ZIP entry: ${entryName}`)
 if(relativeOffset<0||relativeOffset>=entry.compressedSize)throw new Error(`Invalid payload offset for ${entryName}`)
 const changed=Buffer.from(archive)
 changed[entry.dataOffset+relativeOffset]^=1
 return changed
}

describe('Office current producer evidence and pinned verification',()=>{
 it('keeps the producer ledger tied to pinned inputs and fixture provenance',()=>{
  const ledger=readJson(ledgerUrl)
  const pin=readJson(pinUrl)
  const fixtureProvenance=readJson(fixtureProvenanceUrl)
  const producerInputs=pin.inputs.filter(input=>!input.path.startsWith('node_modules/'))

  expect(ledger).toMatchObject({
   producerRepository:'Freshair129/visual-office',
   producerRevision:'1dff013dd45691bf1a0eced3e7d3ac988ac1e379',
   pinnedRevision:pin.revision,
   changedInputs:['web/office-characters.js','web/tycoon-models.js','web/tycoon-state.js'],
   unchangedInputCount:28
  })
  expect(ledger.pinnedRevision).toBe(pin.revision)
  expect(ledger.changedInputs.every(input=>producerInputs.some(pinned=>pinned.path===input))).toBe(true)
  expect(new Set(ledger.changedInputs).size).toBe(ledger.changedInputs.length)
  expect(ledger.unchangedInputCount+ledger.changedInputs.length).toBe(producerInputs.length)
  expect(producerInputs).toHaveLength(31)
  for(const name of ['stock','custom']){
   expect(ledger[name].archiveSha256).toBe(fixtureProvenance[name].archiveSha256)
   expect(ledger[name].contentHash).toBe(fixtureProvenance[name].contentHash)
  }
 })

 it('accepts the unmodified committed stock fixture',async()=>{
  await expect(verifyOfficeArchive(stockFixture())).resolves.toMatchObject({
   manifest:{entities:expect.any(Array)},
   assets:expect.any(Array)
  })
 },120000)

 it('rejects a bit flip in the first stored asset without repacking',async()=>{
  const archive=stockFixture()
  await expect(verifyOfficeArchive(archive)).resolves.toMatchObject({
   manifest:{entities:expect.any(Array)},
   assets:expect.any(Array)
  })
  const firstAsset=zipEntries(archive).find(entry=>entry.name.startsWith('assets/'))
  expect(firstAsset).toBeDefined()
  const changed=flipStoredEntryByte(archive,firstAsset.name,Math.floor(firstAsset.compressedSize/2))
  await expect(verifyOfficeArchive(changed)).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
 },120000)

 it('rejects a bit flip in manifest bytes without rehashing',async()=>{
  const archive=stockFixture()
  const files=readHandoffArchive(archive)
  const manifest=JSON.parse(files.get('manifest.json').toString('utf8'))
  const manifestBytes=files.get('manifest.json')
  const hashOffset=manifestBytes.indexOf(Buffer.from(manifest.contentHash))
  expect(hashOffset).toBeGreaterThanOrEqual(0)
  const changed=flipStoredEntryByte(archive,'manifest.json',hashOffset)
  await expect(verifyOfficeArchive(changed)).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
 },120000)

 it('rejects bytes appended after the ZIP end record',async()=>{
  const changed=Buffer.concat([stockFixture(),Buffer.from([0x01,0x02,0x03])])
  await expect(verifyOfficeArchive(changed)).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
 },120000)

 it('rejects an unexpected file in a validly repacked archive',async()=>{
  const archive=stockFixture()
  const files=readHandoffArchive(archive)
  const manifest=JSON.parse(files.get('manifest.json').toString('utf8'))
  const schema=JSON.parse(files.get('schema.json').toString('utf8'))
  const blobs=new Map([...files].filter(([name])=>name.startsWith('assets/')))
  blobs.set(`assets/${'a'.repeat(64)}.glb`,Buffer.from('unexpected file'))
  await expect(verifyOfficeArchive(handoffZip(manifest,blobs,schema))).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
 },120000)

 it.skipIf(!process.env.VISUAL_OFFICE_CHECKOUT)(
  'accepts current producer stock and custom exports against the pinned verifier',
  async()=>{
   const checkout=process.env.VISUAL_OFFICE_CHECKOUT
   const ledger=readJson(ledgerUrl)
   const tempDirectory=path.resolve(os.tmpdir())
   const producerDirectory=realpathSync(checkout)
   const realTempDirectory=realpathSync(tempDirectory)
   const tempRelative=path.relative(producerDirectory,realTempDirectory)
   expect(path.isAbsolute(tempRelative)||tempRelative.startsWith('..')).toBe(true)
   const outDir=mkdtempSync(path.join(tempDirectory,'office-current-'))
   const helper=fileURLToPath(new URL('../helpers/office-current-producer.mjs',import.meta.url))
   try{
    const result=spawnSync(process.execPath,[helper,checkout,outDir,'all'],{encoding:'utf8',timeout:240000})
    expect(result.error).toBeUndefined()
    expect(result.status,result.stderr).toBe(0)
    const report=JSON.parse(result.stdout.trim())
    const stock=readFileSync(path.join(outDir,'stock.zip'))
    const custom=readFileSync(path.join(outDir,'custom.zip'))
    const producerRevision=execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim()

    expect(report.producerRevision).toBe(producerRevision)
    expect(report.stock.archiveSha256).toBe(sha256(stock))
    expect(report.custom.archiveSha256).toBe(sha256(custom))
    await expect(verifyOfficeArchive(stock)).resolves.toBeDefined()
    await expect(verifyOfficeArchive(custom)).resolves.toBeDefined()
    if(producerRevision===ledger.producerRevision){
     expect(report.stock.archiveSha256).toBe(ledger.stock.archiveSha256)
     expect(report.stock.contentHash).toBe(ledger.stock.contentHash)
     expect(report.custom.archiveSha256).toBe(ledger.custom.archiveSha256)
     expect(report.custom.contentHash).toBe(ledger.custom.contentHash)
     expect(report.changedInputs).toEqual(ledger.changedInputs)
    }else{
     console.warn(`Visual Office HEAD ${producerRevision} differs from ledger; verifier bump review required. Drift: ${JSON.stringify(report.changedInputs)}`)
    }
   }finally{
    rmSync(outDir,{recursive:true,force:true})
   }
  },300000
 )
})
