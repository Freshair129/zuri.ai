import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ISOLATED_SERVICES, contractTestsFor, isolatedServices, scopeOutputs,
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
    expect(isolatedServices('services/scm/src/main.js\nservices/scm/test/unit/core-client.test.js'))
      .toEqual(['scm'])
  })

  it('fails safe to the full suite for anything else', () => {
    for (const diff of [
      '',
      'services/conversation-runtime/src/a.js\napps/server/src/a.js',
      'services/conversation-runtime/src/a.js\ndocs/migrations/service-extraction/CONVERSATION-RUNTIME-HANDOFF.md',
      'services/scm/src/a.js\napps/server/src/modules/inventory/application/scm-core-facade.js',
      'services/scm-evil/src/a.js',
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
    expect(scopeOutputs('services/scm/src/infrastructure/core-client.js', serverRoot).contracts)
      .toContain('tests/integration/scm-core-facade-http.test.js')
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
