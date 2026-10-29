// @spec ADR-115 — explicit manual packaging only; no publication/deployment.
// @tested tests/node/compact-workflow.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { runInNewContext } from 'node:vm'

test('prepared input producer is manual, isolated and publishes only its validated directory', async () => {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/docker-image.yml', import.meta.url), 'utf8'))
  assert.equal(workflow.on.workflow_dispatch.inputs.compact_prepare_input?.default, false)
  const job = workflow.jobs['compact-prepare']; assert(job)
  assert.match(job.if, /github.event_name == 'workflow_dispatch'/)
  assert.match(job.if, /inputs.compact_prepare_input/)
  assert.deepEqual(job.permissions, { contents: 'read' })
  assert.equal(job.steps.find(s => s.uses === 'actions/checkout@v4').with?.['fetch-depth'], 0, 'canonical governance needs its pinned historical source objects')
  assert.equal(job.env.COMPACT_TEST_DOCKER_CONTEXT, 'compact-prepare-ci')
  const commands = job.steps.filter(s => s.run).map(s => s.run).join('\n')
  assert.match(commands, /git -C \.\.\/\.\. archive "\$GITHUB_SHA" apps\/server/); assert.match(commands, /--provenance=false/)
  assert.match(commands, /org.opencontainers.image.revision/)
  assert.match(commands, /test:compact:provider/)
  assert.doesNotMatch(commands, /docker (?:push|login|system prune)|secrets\./)
  const upload = job.steps.find(s => s.uses?.startsWith('actions/upload-artifact'))
  assert.equal(upload.with.path, '${{ runner.temp }}/compact-prepared')
  assert.equal(upload.with['include-hidden-files'], true)
  assert.equal(upload.if, undefined, 'failed producer must not upload an input candidate')
})

test('the TEST provider recipe pins both source commits and base images and retains license notices', async () => {
  const recipe = await readFile(new URL('../../deploy/compact/Minio.test.Dockerfile', import.meta.url), 'utf8')
  assert.match(recipe, /go install github.com\/minio\/minio@[a-f0-9]{40}/)
  assert.match(recipe, /go install github.com\/minio\/mc@[a-f0-9]{40}/)
  assert.equal((recipe.match(/^FROM \S+@sha256:[a-f0-9]{64}/gm) || []).length, 2)
  assert.match(recipe, /GOTOOLCHAIN=local/)
  assert.match(recipe, /MINIO-LICENSE/); assert.match(recipe, /MC-LICENSE/)
  assert.doesNotMatch(recipe, /@latest|secrets\.|password|token|production approval/i)
})

test('the default E2E profile excludes the independently owned Compact fixture', async () => {
  const source = await readFile(new URL('../../playwright.config.js', import.meta.url), 'utf8')
  assert.match(source, /testIgnore:\s*\[[^\]]*compact-core\.spec\.js/)
  const compact = await readFile(new URL('../../playwright.compact.config.js', import.meta.url), 'utf8')
  assert.match(compact, /testMatch:\s*'compact-core\.spec\.js'/)
  assert.doesNotMatch(compact, /globalSetup:|webServer:/)
})

async function provenance() {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/docker-image.yml', import.meta.url), 'utf8'))
  const steps = workflow.jobs['compact-package'].steps, step = steps.find(s => s.name === 'Verify prepared artifact origin')
  assert(step?.uses?.startsWith('actions/github-script'))
  assert(steps.indexOf(step) < steps.findIndex(s => s.uses?.startsWith('actions/download-artifact')))
  return step.with.script
}
test('manual package job preserves existing build-only jobs and read-only authority', async () => {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/docker-image.yml', import.meta.url), 'utf8'))
  const job = workflow.jobs['compact-package']
  assert(job, 'explicit opt-in compact-package job must exist')
  assert.equal(workflow.on.workflow_dispatch.inputs.compact_package.default, false)
  assert.match(job.if, /github.event_name == 'workflow_dispatch'/)
  assert.match(job.if, /inputs.compact_package/)
  assert.deepEqual(job.permissions, { contents: 'read', actions: 'read' })
  assert.equal(workflow.jobs.build.steps.find(s => s.uses?.startsWith('docker/build-push-action')).with.push, false)
  const commands = job.steps.filter(s => s.run).map(s => s.run).join('\n')
  assert.match(commands, /--expected-revision/)
  assert.equal(/docker (?:compose|run|build|push)|--deploy|db push|production/i.test(commands), false)
  assert(job.steps.some(s => s.uses?.startsWith('actions/download-artifact')))
  const upload = job.steps.find(s => s.uses?.startsWith('actions/upload-artifact'))
  assert(upload)
  assert.equal(upload.with['include-hidden-files'], true, 'the required docs/.doc-graph.json must survive candidate upload')
})

test('cold core CI is explicit, consumes the same-run verified OCI candidate and uploads only sanitized observations', async () => {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/docker-image.yml', import.meta.url), 'utf8'))
  const job = workflow.jobs['compact-core']
  assert(job, 'explicit compact-core job must exist')
  assert.equal(workflow.on.workflow_dispatch.inputs.compact_qualify_core.default, false)
  assert.equal(job.needs, 'compact-package'); assert.match(job.if, /inputs.compact_qualify_core/); assert.match(job.if, /inputs.compact_package/)
  assert.deepEqual(job.permissions, { contents: 'read', actions: 'read' })
  const steps = job.steps, verification = steps.findIndex(s => s.name === 'Verify exact OCI candidate before image load'), load = steps.findIndex(s => s.name === 'Load selected candidate images')
  assert(verification >= 0 && load > verification)
  assert(steps.some(s => s.uses === 'docker/setup-docker-action@v5' && JSON.parse(s.with['daemon-config']).features['containerd-snapshotter'] === true))
  assert.equal(job.env.COMPACT_TEST_DOCKER_CONTEXT, 'compact-core-ci')
  assert.equal(steps.find(s => s.uses === 'docker/setup-docker-action@v5').with.context, job.env.COMPACT_TEST_DOCKER_CONTEXT)
  assert.match(steps[load].run, /--context "\$COMPACT_TEST_DOCKER_CONTEXT"/)
  const download = steps.find(s => s.uses?.startsWith('actions/download-artifact')); assert.equal(download.with.name, 'compact-candidate-${{ github.sha }}'); assert.equal(download.with['run-id'], undefined)
  const commands = steps.filter(s => s.run).map(s => s.run).join('\n')
  assert.match(commands, /--expected-revision/); assert.match(commands, /npm run test:compact:core/); assert.match(commands, /npm run test:compact:recovery/)
  assert.doesNotMatch(commands, /docker (?:pull|push|login|system prune)|db push|--deploy/i)
  const upload = steps.find(s => s.uses?.startsWith('actions/upload-artifact'))
  assert.equal(upload.if, 'always()'); assert.match(upload.with.path, /sanitized-observation\.json/); assert.doesNotMatch(upload.with.path, /\.sql|\.bin|compact-package|private target|\.env/)
})

test('runner-local paths are initialized after job allocation, never in job-level expressions', async () => {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/docker-image.yml', import.meta.url), 'utf8'))
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const value of Object.values(job.env || {})) {
      assert.doesNotMatch(String(value), /\$\{\{\s*runner\./, `${name}: runner context is unavailable in jobs.<job_id>.env`)
    }
  }
  const steps = workflow.jobs['compact-core'].steps
  const initialize = steps.findIndex(s => s.name === 'Set job-local qualification paths')
  assert(initialize >= 0 && initialize < steps.findIndex(s => s.name === 'Verify exact OCI candidate before image load'))
  const script = steps[initialize].run
  for (const key of ['COMPACT_PACKAGE_DIRECTORY', 'COMPACT_CORE_IMAGE_FILE', 'COMPACT_CORE_EVIDENCE_DIRECTORY', 'COMPACT_RECOVERY_PRIVATE_DIRECTORY']) {
    assert.match(script, new RegExp(`${key}=\\$RUNNER_TEMP/`))
  }
  assert.match(script, />>\s*"\$GITHUB_ENV"/)
})

test('prepared artifact origin guard accepts only an exact successful same-repository run', async () => {
  const script = await provenance(), sha = 'a'.repeat(40)
  const fixtures = () => ({
    run: { id: 12, status: 'completed', conclusion: 'success', head_sha: sha, repository: { id: 10 }, head_repository: { id: 10 } },
    artifact: { id: 34, expired: false, workflow_run: { id: 12, repository_id: 10, head_repository_id: 10, head_sha: sha } },
  })
  const mutations = [null, f => { f.run.head_sha = 'b'.repeat(40) }, f => { f.run.conclusion = 'failure' }, f => { f.run.status = 'in_progress' }, f => { f.run.head_repository.id = 11 }, f => { f.artifact.expired = true }, f => { f.artifact.workflow_run.id = 99 }, f => { f.artifact.workflow_run.head_sha = 'b'.repeat(40) }, f => { f.artifact.workflow_run.repository_id = 11 }, f => { f.artifact.id = 99 }]
  for (const mutate of mutations) {
    const f = fixtures(), calls = []; let failed
    mutate?.(f)
    const context = { sha, repo: { owner: 'test', repo: 'zuri' }, payload: { repository: { id: 10 } } }
    const github = { rest: { actions: {
      getWorkflowRun: async args => { calls.push(args); return { data: f.run } },
      getArtifact: async args => { calls.push(args); return { data: f.artifact } },
    } } }
    await runInNewContext(`(async () => { ${script}\n })()`, { github, context, process: { env: { INPUT_RUN_ID: '12', INPUT_ARTIFACT_ID: '34' } }, core: { setFailed: code => { failed = code } } })
    assert.equal(failed, mutate ? 'COMPACT_INPUT_ORIGIN_INVALID' : undefined)
    assert.equal(calls[0].run_id, 12); assert.equal(calls[1].artifact_id, 34)
  }
})

test('fresh PostgreSQL CI covers schema producers and SQL sources on a disposable Linux runner', async () => {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/compact-postgres.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  for (const event of ['push', 'pull_request']) for (const file of ['apps/server/prisma/**', 'apps/server/scripts/gen-postgres-schema.mjs', 'apps/server/supabase/migrations/**']) assert(workflow.on[event].paths.includes(file), `missing ${event} input ${file}`)
  const job = workflow.jobs['fresh-postgres']; assert.equal(job['runs-on'], 'ubuntu-latest')
  const commands = job.steps.filter(s => s.run).map(s => s.run).join('\n')
  assert.match(commands, /docker pull postgres@sha256:[a-f0-9]{64}/)
  assert.match(commands, /npm run test:postgres -- tests\/postgres\/compact-fresh-install\.test\.js/)
  assert.equal(/db push|(?:docker|npm) (?:push|login)|secrets\./i.test(JSON.stringify(job)), false)
})

test('Compact PostgreSQL CI selects Marketing intake/authority changes and executes the native runtime suite', async () => {
  const workflow = parse(await readFile(new URL('../../../../.github/workflows/compact-postgres.yml', import.meta.url), 'utf8'))
  for (const event of ['push', 'pull_request']) for (const file of ['apps/server/src/modules/marketing/**', 'apps/server/src/app/api/growth/external-marketing-reports/**', 'apps/server/tests/postgres/marketing-report-native.test.js', 'apps/server/tests/unit/marketing-report-*.test.js']) assert(workflow.on[event].paths.includes(file), `missing ${event} input ${file}`)
  const commands = workflow.jobs['fresh-postgres'].steps.filter(step => step.run).map(step => step.run).join('\n')
  assert.match(commands, /npm run test:postgres -- tests\/postgres\/marketing-report-native\.test\.js/)
})

test('preflight admits only the exact report-principal route with trusted provider and strict wire delegation', async () => {
  const guard = await import('../../scripts/marketing-report-route-policy.mjs').catch(() => null)
  assert(guard, 'provider-aware machine-principal recognition must exist')
  const file = 'src/app/api/growth/external-marketing-reports/route.js'
  const body = await readFile(new URL('../../src/app/api/growth/external-marketing-reports/route.js', import.meta.url), 'utf8')
  assert.equal(guard.isMarketingReportMachineReceiver(file, body), true)
  for (const badFile of [file.replace('external-marketing-reports', 'other'), file.replace('growth/', 'admin/')]) assert.equal(guard.isMarketingReportMachineReceiver(badFile, body), false)
  for (const changed of [
    body.replace('reportCredentialHash(authorization)', ''),
    body.replace("request.headers.get('authorization')", "request.headers.get('session')"),
    body.replace('readMarketingReportRequest(request)', 'request.json()'),
    body.replace('resolveMarketingReportDatabase()', 'resolveMarketingReportDatabase(request)'),
    body.replace('provider: selected?.provider', 'provider: request.provider'),
    body.replace('db: selected?.db', 'db: request.database'),
    body.replace('raw: canonicalEnvelope', 'raw: request.body'),
    body.replace("@/modules/marketing/infrastructure/marketing-report-database", '@/untrusted-database'),
  ]) assert.equal(guard.isMarketingReportMachineReceiver(file, changed), false)
})

test('machine-principal exemption refuses comment-only and dead-code authorization decoys', async () => {
  const guard = await import('../../scripts/marketing-report-route-policy.mjs')
  const file = 'src/app/api/growth/external-marketing-reports/route.js'
  const body = await readFile(new URL('../../src/app/api/growth/external-marketing-reports/route.js', import.meta.url), 'utf8')
  for (const changed of [
    `/* ${body} */\nexport async function POST(request) { return Response.json({ok:true}) }`,
    body.replace('export async function POST(request)', 'async function unusedAuthorizationDecoy(request)') + '\nexport async function POST(request) { return Response.json({ok:true}) }',
    body.replace('export async function POST(request)', 'export async function POST(request) { if (false) return unused(request); return Response.json({ok:true}) }\nasync function unused(request)'),
    'const documentationOnly = ' + JSON.stringify(body) + '\nexport async function POST(request) { return Response.json({ok:true}) }',
  ]) assert.equal(guard.isMarketingReportMachineReceiver(file, changed), false)
  assert.equal(guard.isMarketingReportMachineReceiver(file, '// Cosmetic comment\n' + body), true)
})
