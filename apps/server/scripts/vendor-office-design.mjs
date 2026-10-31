// @req FR-294 — build a pinned, offline verifier; package-supplied code is never loaded.
import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
const source = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw Error('Provide the reviewed Visual Office checkout')
const revision = 'b4e2d8edec9d8dbad32573d860cff3a6a27efbbd'
const git = args => execFileSync('git',args,{cwd:source,encoding:'utf8',windowsHide:true}).trim()
if (git(['rev-parse','HEAD']) !== revision || git(['status','--porcelain','--untracked-files=no'])) throw Error('Producer must match clean pinned source')
const require = createRequire(path.join(source,'package.json'))
const esbuild = require('esbuild')
if (JSON.parse(await fs.readFile(path.join(source,'node_modules/three/package.json'))).version !== '0.180.0') throw Error('Pinned Three.js required')
const out = new URL('../vendor/office-design/',import.meta.url)
await fs.mkdir(out,{recursive:true})
const result = await esbuild.build({stdin:{contents:`export {validateOfficeHandoff,buildOfficeHandoff,buildOfficeHandoffSchema} from './web/office-handoff.js'; export {verifyCustomAssetMeasurements,handoffZip,collectHandoffAssets} from './web/office-handoff-assets.js'; export {inspectGLBContainer,inspectCustomGLB,describeCustomAsset,disposeCustomModel} from './web/custom-assets.js'; export {canonicalJSON,sha256} from './web/office-world-identity.js'; export {createTycoonRoom} from './web/tycoon-state.js'; export {OFFICE_FLOORS} from './web/office-floor-registry.js';`,resolveDir:source,sourcefile:'office-verifier-entry.js'},absWorkingDir:source,bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node20',legalComments:'eof'})
const bundle=result.outputFiles[0].contents
await fs.writeFile(new URL('verifier.mjs',out),bundle)
const schema=await fs.readFile(path.join(source,'contracts/office-design-handoff-v1.schema.json'))
await fs.writeFile(new URL('schema.json',out),schema)
const archive=await fs.readFile(path.join(source,'scripts/office-handoff-archive.mjs'))
await fs.writeFile(new URL('archive.mjs',out),archive)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const inputs=[]
for(const file of Object.keys(result.metafile.inputs).sort()) if(file!=='office-verifier-entry.js')inputs.push({path:file.replaceAll('\\','/'),sha256:hash(await fs.readFile(path.join(source,file)))})
inputs.push({path:'scripts/office-handoff-archive.mjs',sha256:hash(archive)})
await fs.writeFile(new URL('provenance.json',out),JSON.stringify({repository:'Freshair129/zuri-visual-office',revision,threeVersion:'0.180.0',esbuildVersion:esbuild.version,bundleSha256:hash(bundle),schemaSha256:hash(schema),archiveSha256:hash(archive),inputs},null,2)+'\n')
await fs.writeFile(new URL('THREE-LICENSE.txt',out),await fs.readFile(path.join(source,'node_modules/three/LICENSE')))
console.log(JSON.stringify({revision,inputs:inputs.length,bundleBytes:bundle.length,bundleSha256:hash(bundle)}))
