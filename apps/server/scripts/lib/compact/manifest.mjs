// @spec ADR-115 — pure strict manifest validation; no runtime qualification.
// @tested tests/node/compact-manifest.test.mjs
import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../../deploy/compact/release-manifest.schema.json' with { type: 'json' }

const validate = new Ajv2020({ strict: true, allErrors: false, ownProperties: true }).compile(schema)
export const REQUIRED_FILES = Object.freeze(['compose.yml', 'env.example', 'README.md', 'release-manifest.schema.json', 'compact-self-host.mjs', 'docs/PRODUCT.md', 'docs/.doc-graph.json', 'registry/document-registry/index.json'])
const reserved = new Set(['release-manifest.json', 'SHA256SUMS', 'images.oci.tar', 'transport.json', '.partial'])
export class CompactError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'CompactError' }
}
const invalid = () => { throw new CompactError('COMPACT_MANIFEST_INVALID') }
function assertJson(value, seen = new Set(), depth = 0) {
  if (depth > 32) invalid()
  if (value === null || ['string', 'boolean'].includes(typeof value)) return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || seen.has(value)) invalid()
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid()
  seen.add(value)
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set || !('value' in descriptor)) invalid()
    assertJson(descriptor.value, seen, depth + 1)
  }
  seen.delete(value)
}
export function isPortablePayloadPath(file) {
  if (typeof file !== 'string' || file.length > 240 || reserved.has(file) || !/^[A-Za-z0-9_. -]+(?:\/[A-Za-z0-9_. -]+)*$/.test(file)) return false
  const segments = file.split('/')
  if (segments.some(p => p === '.' || p === '..' || p !== p.trim() || p.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(p.split('.')[0].trim()))) return false
  if (segments.some(p => /^(\.git|\.brain|\.codex|node_modules|secrets|credentials)$/i.test(p))) return false
  if (file !== 'env.example' && segments.some(p => /^\.env(?:\.|$)/i.test(p) || /\.(?:key|pem|pfx|p12)$/i.test(p) || /^(?:id_rsa|credentials\.json)$/i.test(p))) return false
  return REQUIRED_FILES.includes(file) || /^(?:docs|registry|schema|qualifications|models|pins)\//.test(file)
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
export function validateCompactManifest(value) {
  assertJson(value)
  if (!validate(value) || value.releaseId.includes('..')) invalid()
  const names = Object.keys(value.files), folded = new Set()
  for (const file of names) {
    if (!isPortablePayloadPath(file) || folded.has(file.toLowerCase())) invalid()
    folded.add(file.toLowerCase())
  }
  if (REQUIRED_FILES.some(file => !Object.hasOwn(value.files, file))) invalid()
  for (const descriptor of [value.schemaBaseline, value.storageQualification.evidence, value.storageQualification.licenseEvidence]) {
    if (!isPortablePayloadPath(descriptor.file) || value.files[descriptor.file] !== descriptor.sha256) invalid()
  }
  const qualifications = [value.storageQualification.evidence.file, value.storageQualification.licenseEvidence.file]
  if (!/^schema\/.+\.sql$/.test(value.schemaBaseline.file) || new Set(qualifications).size !== 2 || qualifications.some(file => !/^qualifications\/.+\.json$/.test(file)) || names.some(file => file.startsWith('qualifications/') && !qualifications.includes(file))) invalid()
  if (value.storageQualification.image !== value.images.storage || value.storageQualification.command.some(s => /password|secret|token|credential|access.?key|api.?key/i.test(s))) invalid()
  const selected = new Set(value.profiles)
  for (const name of ['line', 'knowledge', 'public']) if (value.capabilities[name] !== (selected.has(name) ? 'NOT_QUALIFIED' : 'NOT_SELECTED')) invalid()
  const needed = ['web', 'tools', 'postgres', 'storage', ...(selected.has('line') ? ['lineWorker'] : []), ...(selected.has('knowledge') ? ['genesisWorker'] : []), ...(selected.has('public') ? ['ngrok'] : [])]
  if (Object.keys(value.images).length !== needed.length || needed.some(k => !Object.hasOwn(value.images, k))) invalid()
  if (selected.has('line') && value.images.lineWorker !== value.images.web) invalid()
  if (selected.has('knowledge')) {
    if (['msp', 'gks', 'genesisblock'].some(k => !value.componentPins[k]) || value.modelArtifacts.length === 0 || !value.files['pins/ki17.json']) invalid()
  } else if (Object.keys(value.componentPins).length || value.modelArtifacts.length) invalid()
  const modelIds = new Set(), modelFiles = new Set()
  for (const model of value.modelArtifacts) {
    if (modelIds.has(model.id)) invalid(); modelIds.add(model.id)
    for (const [file, hash] of Object.entries(model.files)) {
      if (!file.startsWith(`models/${model.id}/`) || !isPortablePayloadPath(file) || value.files[file] !== hash || modelFiles.has(file)) invalid()
      modelFiles.add(file)
    }
  }
  if (names.some(file => file.startsWith('models/') && !modelFiles.has(file))) invalid()
  return freeze(structuredClone(value))
}
