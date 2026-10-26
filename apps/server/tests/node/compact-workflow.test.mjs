// @spec ADR-115 — explicit manual packaging only; no publication/deployment.
// @tested tests/node/compact-workflow.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { runInNewContext } from 'node:vm'

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
