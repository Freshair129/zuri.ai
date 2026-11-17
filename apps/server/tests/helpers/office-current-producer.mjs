// @req FR-294 — generate current Visual Office exports for offline pinned-verifier checks.
// @tested tests/unit/office-design-current-producer.test.js
// This helper dynamically imports and executes code from the given local producer checkout.
// Only point it at a checkout you trust; it never writes inside that checkout.
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {gunzipSync} from 'node:zlib'

const helperDirectory=path.dirname(fileURLToPath(import.meta.url))
const pinnedProvenancePath=path.resolve(helperDirectory,'../../vendor/office-design/provenance.json')
const customFixturePath=path.resolve(helperDirectory,'../fixtures/office-design/custom.zip.gz')
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')

function resolveThroughExistingAncestor(candidate){
 const absolute=path.resolve(candidate)
 const missing=[]
 let cursor=absolute
 while(!existsSync(cursor)){
  const parent=path.dirname(cursor)
  if(parent===cursor)throw new Error(`Cannot resolve output directory: ${candidate}`)
  missing.unshift(path.basename(cursor))
  cursor=parent
 }
 return path.resolve(realpathSync(cursor),...missing)
}

function isInside(parent,candidate){
 const relative=path.relative(parent,candidate)
 return relative===''||relative==='.'||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`))
}

function assertOutsideProducer(producerDirectory,outputDirectory){
 if(isInside(producerDirectory,outputDirectory))throw new Error('Refusing to write inside the Visual Office producer checkout')
}

function assertEmptyOutputDirectory(outputDirectory){
 if(!existsSync(outputDirectory))return
 if(!statSync(outputDirectory).isDirectory())throw new Error('Output path must be a directory')
 if(readdirSync(outputDirectory).length!==0)throw new Error('Output directory already exists and is not empty')
}

function gitOutput(producerDirectory,args){
 return execFileSync('git',['-C',producerDirectory,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
}

function producerDrift(producerDirectory,pinnedProvenance){
 const inputs=pinnedProvenance.inputs.filter(input=>!input.path.startsWith('node_modules/'))
 const changedInputs=[]
 let unchangedInputCount=0
 for(const input of inputs){
  let blob
  try{
   blob=execFileSync('git',['-C',producerDirectory,'show',`HEAD:${input.path}`],{stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024})
  }catch{
   changedInputs.push(input.path)
   continue
  }
  const crlf=Buffer.from(blob.toString('utf8').replace(/\r?\n/g,'\r\n'),'utf8')
  if(sha256(blob)===input.sha256||sha256(crlf)===input.sha256)unchangedInputCount++
  else changedInputs.push(input.path)
 }
 return {changedInputs,unchangedInputCount}
}

async function main(){
 const [producerArgument,outputArgument,mode]=process.argv.slice(2)
 if(!producerArgument||!outputArgument||!['all','stock','custom'].includes(mode)){
  throw new Error('Usage: node office-current-producer.mjs <producerCheckout> <outDir> <all|stock|custom>')
 }
 const producerDirectory=realpathSync(path.resolve(producerArgument))
 if(!statSync(producerDirectory).isDirectory())throw new Error('Producer checkout must be a directory')
 const trackedStatus=gitOutput(producerDirectory,['status','--porcelain','--untracked-files=no'])
 if(trackedStatus!=='')throw new Error('Refusing to import from a Visual Office producer checkout with tracked changes')
 const outputCandidate=path.resolve(outputArgument)
 assertOutsideProducer(producerDirectory,resolveThroughExistingAncestor(outputCandidate))
 assertEmptyOutputDirectory(outputCandidate)

 const producerRevision=gitOutput(producerDirectory,['rev-parse','HEAD'])
 const pinnedProvenance=JSON.parse(readFileSync(pinnedProvenancePath,'utf8'))
 const drift=producerDrift(producerDirectory,pinnedProvenance)
 const importProducer=relativePath=>import(pathToFileURL(path.join(producerDirectory,relativePath)).href)
 const generated={}

 if(mode==='all'||mode==='stock'){
  const {OFFICE_FLOORS}=await importProducer('web/office-floor-registry.js')
  const {createTycoonRoom}=await importProducer('web/tycoon-state.js')
  const {buildOfficeHandoff,buildOfficeHandoffSchema}=await importProducer('web/office-handoff.js')
  const {collectHandoffAssets,handoffZip}=await importProducer('web/office-handoff-assets.js')
  const rooms=Object.fromEntries(OFFICE_FLOORS.map(floor=>[floor.key,createTycoonRoom(floor.key)]))
  const assets=await collectHandoffAssets(rooms,{readFile:relativePath=>readFile(path.join(producerDirectory,'web',relativePath))})
  const manifest=await buildOfficeHandoff({rooms,assets:assets.descriptors})
  const archive=Buffer.from(handoffZip(manifest,assets.blobs,await buildOfficeHandoffSchema()))
  generated.stock={archive,report:{archiveSha256:sha256(archive),contentHash:manifest.contentHash}}
 }

 if(mode==='all'||mode==='custom'){
  const {buildOfficeHandoff}=await importProducer('web/office-handoff.js')
  const {handoffZip}=await importProducer('web/office-handoff-assets.js')
  const {readHandoffArchive}=await importProducer('scripts/office-handoff-archive.mjs')
  const fixture=readHandoffArchive(gunzipSync(readFileSync(customFixturePath)))
  const sourceManifest=JSON.parse(fixture.get('manifest.json').toString('utf8'))
  const rooms=Object.fromEntries(sourceManifest.entities.filter(entity=>entity.type==='scene').map(entity=>[entity.key.split('/')[0],entity.data.snapshot]))
  const assets={}
  for(const revision of sourceManifest.entities.filter(entity=>entity.type==='assetRevision')){
   const asset=sourceManifest.entities.find(entity=>entity.id===revision.refs.find(ref=>ref.relation==='asset').targetId)
   assets[asset.key]=revision.data
  }
  const manifest=await buildOfficeHandoff({rooms,assets})
  const archive=Buffer.from(handoffZip(manifest,new Map([...fixture].filter(([name])=>name.startsWith('assets/'))),JSON.parse(fixture.get('schema.json').toString('utf8'))))
  generated.custom={archive,report:{archiveSha256:sha256(archive),contentHash:manifest.contentHash}}
 }

 mkdirSync(outputCandidate,{recursive:true})
 const outputDirectory=realpathSync(outputCandidate)
 assertOutsideProducer(producerDirectory,outputDirectory)
 assertEmptyOutputDirectory(outputDirectory)
 for(const [name,value] of Object.entries(generated))writeFileSync(path.join(outputDirectory,`${name}.zip`),value.archive)
 const report={producerRevision,mode,stock:generated.stock?.report??null,custom:generated.custom?.report??null,...drift}
 process.stdout.write(`${JSON.stringify(report)}\n`)
}

main().catch(error=>{
 process.stderr.write(`office-current-producer: ${error?.message??error}\n`)
 process.exitCode=1
})
