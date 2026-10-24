// @req FR-084 — demo seed uses the same declared handoff writer as the app.
// @spec ADR-035, BR-017
// @tested tests/e2e/dependency-handoff.spec.js
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const NodeModule = require('node:module')
let compiled
async function service() {
  if (!compiled) compiled = (async () => {
    const result = await build({
      stdin: { contents: "export {dryRunPlanDelta,commitPlanDelta} from './src/modules/project-manager/import/plan-delta-service.js'; export {resolveViewer} from './src/modules/identity/resolve-viewer.js'; export {withPipelineTransaction,pipelineTransactionFacade} from './src/modules/project-manager/application/pipeline-writer.js'", resolveDir: root, loader: 'js' },
      absWorkingDir: root, alias: { '@': path.join(root, 'src') }, bundle: true,
      write: false, format: 'cjs', packages: 'external', platform: 'node', target: 'node20', logLevel: 'silent',
      plugins: [{ name: 'seed-injected-db-only', setup(context) {
        context.onResolve({ filter: /(?:^@\/lib\/db$|(?:^|\/)lib\/db(?:\.js)?$)/ }, () => ({ path: 'seed-db', namespace: 'seed-db' }))
        context.onResolve({ filter: /^lucide-react$/ }, () => ({ path: path.join(root, 'node_modules/lucide-react/dist/esm/lucide-react.js') }))
        context.onLoad({ filter: /.*/, namespace: 'seed-db' }, () => ({ contents: 'export const prisma = {}; export default prisma', loader: 'js' }))
      } }],
    })
    const filename = path.join(root, '.pipeline-seed-in-memory.cjs')
    const module = new NodeModule(filename)
    module.filename = filename
    module.paths = NodeModule._nodeModulePaths(root)
    module._compile(result.outputFiles[0].text, filename)
    return module.exports
  })()
  return compiled
}

export async function seedDeclaredHandoff(db, { projectId, actorPersonId, command }) {
  const app = await service()
  const viewer = await app.resolveViewer({ principalId: actorPersonId, db })
  const plan = { schemaVersion: '1.3', kind: 'PROJECT_DELTA', projectId, trace: { correlationId: randomUUID(), idempotencyKey: randomUUID() }, expectedPreviewHash: null, commands: [command] }
  const dry = await app.dryRunPlanDelta(plan, { db, viewer })
  if (!dry.valid) throw new Error('SEED_HANDOFF_PREVIEW_REFUSED: ' + dry.errors[0].code)
  const result = await app.commitPlanDelta({ ...plan, expectedPreviewHash: dry.previewHash }, { db, viewer })
  if (!result.committed) throw new Error('SEED_HANDOFF_COMMIT_REFUSED: ' + result.errors[0].code)
  return result
}

export async function withPipelineSeed(db, callback) {
  const app = await service()
  return app.withPipelineTransaction(db, tx => callback(app.pipelineTransactionFacade(tx)))
}
