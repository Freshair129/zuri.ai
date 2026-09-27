import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  FAN_OUT_LIMIT, FULL_SUITE_TRIGGERS, ISOLATED_SERVICES, POSTGRES_TEST, contractTestsFor, isolatedServices,
  relatedEligibility, relatedOutputs, relatedShardCount, scopeOutputs, selectRelated,
} from '../../../../scripts/ci-change-scope.mjs'
import { workspaceRoot } from '../../scripts/workspace-path.mjs'

const root = workspaceRoot(process.cwd())
const workflow = readFileSync(path.join(root, '.github/workflows/governance.yml'), 'utf8')

describe('CI service scope classification', () => {
  it('is service-scoped only when the whole diff is inside isolated services', () => {
    expect(isolatedServices('services/conversation-runtime/src/a.js\nservices/conversation-runtime/test/a.test.js\n'))
      .toEqual(['conversation-runtime'])
    expect(isolatedServices('services/market-intelligence/src/a.js\nservices/conversation-runtime/package.json'))
      .toEqual(['conversation-runtime', 'market-intelligence'])
  })

  it('fails safe to the full suite for anything else', () => {
    for (const diff of [
      '',
      'services/conversation-runtime/src/a.js\napps/server/src/a.js',
      'services/conversation-runtime/src/a.js\ndocs/migrations/service-extraction/CONVERSATION-RUNTIME-HANDOFF.md',
      'services/scm/src/a.js',
      'services/unknown/src/a.js',
      'services/conversation-runtime',
      'services/conversation-runtime-evil/src/a.js',
      'apps/server/docker-compose.conversation-runtime.yml',
      '.github/workflows/governance.yml',
      'scripts/ci-change-scope.mjs',
    ]) expect(isolatedServices(diff), diff).toBeNull()
  })

  it('selects the apps/server tests that reference a changed service directory', () => {
    const files = {
      'tests/integration/cr-contract.test.js': "import x from '../../../../services/conversation-runtime/src/model-port.js'",
      'tests/integration/market-contract.test.js': "new URL('../../../../services/market-intelligence/contracts/v1/x.json', import.meta.url)",
      'tests/unit/unrelated.test.js': "import y from '@/modules/crm/a.js'",
    }
    expect(contractTestsFor(['conversation-runtime'], files)).toEqual(['tests/integration/cr-contract.test.js'])
    expect(contractTestsFor(['conversation-runtime', 'market-intelligence'], files))
      .toEqual(['tests/integration/cr-contract.test.js', 'tests/integration/market-contract.test.js'])
  })

  it('finds the real Core-side contract tests for each isolated service', () => {
    const serverRoot = path.join(root, 'apps', 'server')
    expect(scopeOutputs('services/conversation-runtime/src/main.js', serverRoot).contracts)
      .toContain('tests/integration/conversation-runtime-model-conformance.test.js')
    expect(scopeOutputs('services/market-intelligence/src/http/server.js', serverRoot).contracts)
      .toContain('tests/integration/market-core-facade-http.test.js')
    expect(scopeOutputs('apps/server/src/a.js', serverRoot)).toEqual({ server: 'true', services: '', contracts: '' })
  })

  it('lists a service as isolated only while governance.yml has a job that tests and builds it', () => {
    for (const name of ISOLATED_SERVICES) {
      expect(workflow, name).toContain(`npm --prefix services/${name} test`)
      expect(workflow, name).toContain(`npm --prefix services/${name} run build`)
    }
  })

  it('never lets verify pass a skipped suite unless changes classified the pull request as service-scoped', () => {
    expect(workflow).toMatch(/needs: \[changes, govern, tests, build,/)
    expect(workflow).toContain('[ "$r" = "skipped" ] && [ "$SERVER" = "false" ]')
    expect(workflow).toContain('[ "$CHANGES" = "success" ] || fail')
    expect(workflow).toContain('npm test -- --shard=${{ matrix.shard }}/4')
  })

  it('reports the scope through the real CLI', () => {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/ci-change-scope.mjs')], {
      input: 'services/conversation-runtime/src/main.js\n', encoding: 'utf8',
    })
    expect(run.status, run.stderr).toBe(0)
    const lines = run.stdout.trim().split(/\r?\n/)
    expect(lines).toContain('server=false')
    expect(lines).toContain('services=conversation-runtime')
    expect(lines.find((line) => line.startsWith('contracts='))).toContain('conversation-runtime-model-conformance.test.js')
  })
})

describe('CI related-test mode (pull requests, "narrow, per FR")', () => {
  // Built at runtime so the doc graph does not read them as real requirement ids.
  const REQ = ['FR', '921'].join('-')
  const SEC = ['SEC', '942'].join('-')
  const all = Array.from({ length: 100 }, (_, i) => `tests/unit/t${String(i).padStart(3, '0')}.test.js`)
  const base = {
    changed: ['apps/server/src/modules/crm/pipeline.js'],
    graph: ['tests/unit/t001.test.js'],
    all,
    testSources: {
      'tests/unit/t001.test.js': "import { x } from '@/modules/crm/pipeline'",
      'tests/unit/t002.test.js': `// @req ${REQ} — verifies the pipeline stage rule`,
      'tests/unit/t003.test.js': `// @req ${REQ}0 is a different id`,
      'tests/unit/t004.test.js': "readFileSync('src/modules/crm/pipeline.js') // string pin",
      'tests/unit/t005.test.js': `// @req ${SEC}`,
    },
    sourceTexts: { 'apps/server/src/modules/crm/pipeline.js': `// @req ${REQ}, ${SEC} — stage rule\n// @tested t009.test.js\nexport const x = 1\n` },
  }

  it('selects importing tests, @req-tagged tests, @tested tests, string pins and changed tests', () => {
    const result = selectRelated({ ...base, changed: [...base.changed, 'apps/server/tests/unit/t050.test.js'] })
    expect(result.mode).toBe('related')
    expect(result.related).toEqual([
      'tests/unit/t001.test.js', // imports the changed file (vitest graph)
      'tests/unit/t002.test.js', // names REQ, which the changed file declares with @req
      'tests/unit/t004.test.js', // names the changed file's path
      'tests/unit/t005.test.js', // names SEC
      'tests/unit/t009.test.js', // the changed file's @tested
      'tests/unit/t050.test.js', // changed itself
    ])
    expect(result.related).not.toContain('tests/unit/t003.test.js')
    expect(result.postgres).toBe(false)
  })

  it('falls back to the full suite on a failed computation, an empty selection or a fan-out above the limit', () => {
    expect(selectRelated({ ...base, graph: null }).mode).toBe('full')
    expect(selectRelated({ ...base, graph: [], testSources: {}, sourceTexts: {} }).mode).toBe('full')
    const limit = Math.floor(all.length * FAN_OUT_LIMIT)
    const fanOut = selectRelated({ ...base, testSources: {}, sourceTexts: {}, graph: all.slice(0, limit + 1) })
    expect(fanOut.mode).toBe('full')
    expect(fanOut.reason).toMatch(/fan-out/)
    expect(selectRelated({ ...base, testSources: {}, sourceTexts: {}, graph: all.slice(0, limit) }).mode).toBe('related')
  })

  it('runs the PostgreSQL WorkToolPort suite only when the change reaches it', () => {
    const withPg = [...all, POSTGRES_TEST]
    expect(selectRelated({ ...base, all: withPg, graph: [POSTGRES_TEST] }).postgres).toBe(true)
    expect(selectRelated({ ...base, all: withPg, changed: ['apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js'] }).postgres).toBe(true)
    expect(selectRelated({ ...base, all: withPg }).postgres).toBe(false)
  })

  it('shards a large selection instead of running it on one runner', () => {
    expect(relatedShardCount(1)).toBe(1)
    expect(relatedShardCount(45)).toBe(1)
    expect(relatedShardCount(46)).toBe(2)
    expect(relatedShardCount(1000)).toBe(4)
  })

  it('is eligible only for apps/server source and test changes (plus docs)', () => {
    for (const diff of [
      'apps/server/src/modules/crm/pipeline.js',
      'apps/server/src/modules/crm/pipeline.js\ndocs/domains/crm/pipeline.md\n.brain/notes.md',
      'apps/server/tests/unit/crm.test.js',
      'apps/server/tests/factories/scope.js',
      'apps/server/runtime/domain-state.json',
      'apps/server/src/app/(control)/control/errors/page.jsx\nservices/conversation-runtime/src/core-client.js',
    ]) expect(relatedEligibility(diff).eligible, diff).toBe(true)
  })

  it('forces the full suite for every fallback trigger', () => {
    const src = 'apps/server/src/modules/crm/pipeline.js\n'
    for (const trigger of [
      'apps/server/prisma/schema.prisma',
      'apps/server/prisma/migrations/20260927000000_x/migration.sql',
      'apps/server/package.json',
      'apps/server/package-lock.json',
      'services/conversation-runtime/package-lock.json',
      'package.json',
      'apps/server/vitest.config.js',
      'apps/server/vitest.related.config.js',
      'apps/server/tests/setup.js',
      'apps/server/tests/global-setup.js',
      'apps/server/tests/global-setup-postgres.js',
      'apps/server/tests/helpers/embedded-postgres.js',
      'apps/server/tests/fixtures/line/event.json',
      '.github/workflows/governance.yml',
      'scripts/ci-change-scope.mjs',
      'apps/server/scripts/vitest-related.mjs',
      'apps/server/src/lib/db.js',
      'apps/server/src/middleware.js',
      'apps/server/.env.example',
      'apps/server/next.config.js',
      'apps/server/jsconfig.json',
      'apps/server/config/runtime.json',
      'apps/server/contracts/v1/x.json',
      'apps/edge/src/index.ts',
      'apps/server/Dockerfile',
      'apps/server/docker-compose.yml',
    ]) expect(relatedEligibility(src + trigger).eligible, trigger).toBe(false)
    expect(relatedEligibility('').eligible).toBe(false)
    expect(relatedEligibility('docs/a.md').eligible).toBe(false)
    expect(relatedEligibility(src, () => false).reason).toMatch(/deleted/)
    expect(FULL_SUITE_TRIGGERS.length).toBeGreaterThan(5)
  })

  it('falls back to the full suite when the graph computation fails', () => {
    const out = relatedOutputs('apps/server/src/modules/agent/line-project-work-tools.js', root, { graphRunner: () => null })
    expect(out.test_mode).toBe('full')
    expect(out.test_shard_total).toBe('4')
  })

  it("computes the real related set with vitest's module graph, including @req-tagged tests", () => {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/ci-change-scope.mjs'), '--related'], {
      input: 'apps/server/src/modules/agent/line-project-work-tools.js\n', encoding: 'utf8', timeout: 170000,
    })
    expect(run.status, run.stderr).toBe(0)
    const lines = run.stdout.trim().split(/\r?\n/)
    expect(lines).toContain('test_mode=related')
    expect(lines).toContain('postgres=true')
    const related = lines.find((line) => line.startsWith('related=')).slice('related='.length).split(' ')
    const all = Number(/\/(\d+) tests/.exec(lines.find((line) => line.startsWith('test_reason=')))[1])
    // imports it transitively: the WorkToolPort contract suite
    expect(related).toContain(POSTGRES_TEST)
    // names a requirement id the module declares with @req, without importing it
    expect(related).toContain('tests/unit/embedded-postgres-cleanup.test.js')
    expect(related.length).toBeLessThanOrEqual(all * FAN_OUT_LIMIT)
  }, 180000)

  it('selects the answer parity suite through the module graph when either answer-policy mirror changes', () => {
    const parity = 'tests/integration/conversation-runtime-answer-parity.test.js'
    for (const mirror of [
      'apps/server/src/modules/agent/line-answer-policy.js',
      'services/conversation-runtime/src/line-answer-policy.js',
    ]) {
      expect(relatedEligibility(`apps/server/src/modules/agent/server-line-answer.js\n${mirror}`).eligible, mirror).toBe(true)
      const run = spawnSync(process.execPath, [path.join(root, 'scripts/ci-change-scope.mjs'), '--related'], {
        input: `${mirror}\n`, encoding: 'utf8', timeout: 170000,
      })
      expect(run.status, run.stderr).toBe(0)
      const lines = run.stdout.trim().split(/\r?\n/)
      expect(lines, mirror).toContain('test_mode=related')
      expect(lines.find((line) => line.startsWith('related=')).split(/[= ]/), mirror).toContain(parity)
    }
    // A services-only mirror change is service-scoped: its own job still runs, unconditionally on PRs.
    expect(isolatedServices('services/conversation-runtime/src/line-answer-policy.js')).toEqual(['conversation-runtime'])
    expect(workflow).toMatch(/\n  conversation-runtime:\n    if: github\.event_name != 'schedule'\n/)
  }, 360000)

  it('pins the workflow: PR-only related mode, ci:full escape hatch, main stays full, verify checks the mode', () => {
    expect(workflow).toContain('types: [opened, synchronize, reopened, labeled]')
    expect(workflow).toContain("if: github.event_name == 'pull_request' && steps.filter.outputs.server == 'true' && !contains(github.event.pull_request.labels.*.name, 'ci:full')")
    expect(workflow).toContain('node scripts/ci-change-scope.mjs --related-eligible')
    expect(workflow).toContain('node scripts/ci-change-scope.mjs --related <')
    expect(workflow).toContain('echo "test_mode=full" >> "$GITHUB_OUTPUT"; exit 0')
    // A push to main leaves `changes` before any scope step: test_mode is empty, i.e. full.
    expect(workflow).toMatch(/if \[ "\$\{\{ github\.event_name \}\}" != "pull_request" \]; then\s+echo "not a pull request — full server suite"\s+echo "server=true" >> "\$GITHUB_OUTPUT"; exit 0/)
    expect(workflow).toContain("shard: ${{ fromJSON(needs.changes.outputs.test_mode == 'related' && needs.changes.outputs.test_shards || '[1, 2, 3, 4]') }}")
    expect(workflow).toContain("if: needs.changes.outputs.test_mode != 'related'\n        run: npm test -- --shard=${{ matrix.shard }}/4")
    expect(workflow).toContain('ZURI_RELATED_TESTS_FILE="$list" npm test -- --config vitest.related.config.js')
    expect(workflow).toContain("if: matrix.shard == 1 && (needs.changes.outputs.test_mode != 'related' || needs.changes.outputs.postgres == 'true')")
    expect(workflow).toContain('[ "$EVENT" = "pull_request" ] || fail "related test mode outside a pull request"')
    expect(workflow).toContain('[ -n "$RELATED" ] || fail "related test mode with an empty test list"')
    expect(workflow).toContain('*) fail "unknown test mode: $TEST_MODE" ;;')
  })

  it('caches installed node_modules only under keys that cover every install input, saved before the tests run', () => {
    expect(workflow).toContain("key: ${{ runner.os }}-server-nm-node22-${{ hashFiles('apps/server/package-lock.json', 'apps/server/prisma/schema.prisma', 'apps/server/scripts/generate-prisma-clients.mjs', 'apps/server/scripts/gen-postgres-schema.mjs') }}")
    expect(workflow).toContain("key: ${{ runner.os }}-edge-nm-node24-${{ hashFiles('apps/edge/package-lock.json') }}")
    expect(workflow).toContain("key: ${{ runner.os }}-server-nm-graph-node22-${{ hashFiles('apps/server/package-lock.json') }}")
    const tests = workflow.slice(workflow.indexOf('\n  tests:\n'), workflow.indexOf('\n  build:\n'))
    expect(tests).not.toMatch(/uses: actions\/cache@/) // restore/save split: a post-job save would capture test output
    expect(tests.indexOf('Save apps/server node_modules')).toBeLessThan(tests.indexOf('Build the doc graph the tests read'))
    expect(tests).toContain("- run: npm ci --no-audit --no-fund\n        if: steps.server-deps.outputs.cache-hit != 'true'")
  })
})
