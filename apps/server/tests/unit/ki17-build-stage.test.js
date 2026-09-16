import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArguments, verifyPins } from '../../deploy/ki17/verify-ki17-pins.mjs'
import { deriveSmartgiftBenchmark } from '../../deploy/ki17/build-smartgift-benchmark.mjs'
import { dockerfileStage, runnerStage } from '../helpers/dockerfile-stage.js'

// @req FR-187 — the SmartGift catalog source adapter's Tier 4 worker is deployed
//   from pinned commits; these are the guards on the build that pins them.
// @spec ADR-075, docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md
// @tested tests/unit/ki17-build-stage.test.js

const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8')
const dockerfile = read('Dockerfile')
const compose = read('docker-compose.yml')
const pins = JSON.parse(read('deploy/ki17/pins.json'))
const example = read('.env.knowledge.example')
const smoke = read('scripts/ki17-smoke.mjs')

describe('the pin manifest', () => {
  it('names all four repositories of the cycle, each at a full 40-character commit', () => {
    // A short sha is ambiguous, and an ambiguous pin is not a pin. The gate G-4
    // comparison is against the commits the G-2 acceptance recorded.
    expect(Object.keys(pins.repositories).sort()).toEqual(['genesisblock', 'gks', 'msp', 'zuri-ai'])
    for (const [name, entry] of Object.entries(pins.repositories)) {
      expect(entry.commit, `${name} commit`).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('records the Node runtime the acceptance ran on, which is not the web image Node', () => {
    // C9/C10: the worker's engines are >=24.18 and MSP/GKS were accepted on 24.18.x,
    // while Next.js stays on Node 22 because Prisma 5.22 does not list 24. If these
    // two ever became the same number it would be by decision, not by drift.
    expect(pins.runtime.node).toMatch(/^24\.18\.\d+$/)
    expect(dockerfile).toContain(`ARG KI17_NODE_VERSION=${pins.runtime.node}`)
    expect(dockerfile).toContain('ARG NODE_VERSION=22')
  })

  it('does not claim to verify zuri-ai own commit, because the build cannot read it', () => {
    // .dockerignore excludes .git from the main context. Recording a pin the build
    // silently cannot check would be worse than recording that it cannot.
    expect(pins.repositories['zuri-ai'].verifiedInBuild).toBe(false)
    for (const name of ['msp', 'gks', 'genesisblock']) {
      expect(pins.repositories[name].verifiedInBuild, name).toBe(true)
    }
  })
})

describe('the pin gate', () => {
  const contexts = [{ name: 'msp', dir: '/ctx/msp' }]
  const manifest = {
    cycle: 'test',
    repositories: { msp: { repository: 'Freshair129/Memory-and-Soul-Passport', commit: 'a'.repeat(40), entrypoints: ['apps/msp-server/bin/msp-server.mjs'] } },
  }
  const run = (resolveResult, exists = () => true) => verifyPins({
    manifest: 'pins.json',
    contexts,
    readManifest: () => manifest,
    resolve: () => resolveResult,
    exists,
  })

  it('passes a context sitting on the pinned commit, and says how it knows', () => {
    const receipt = run({ commit: 'a'.repeat(40), provenance: 'git', detail: '/ctx/msp/.git' })
    expect(receipt.contexts[0]).toMatchObject({ name: 'msp', commit: 'a'.repeat(40), provenance: 'git' })
  })

  it('fails a context at a different commit, naming both commits', () => {
    // The whole point: a build that quietly bakes a different MSP than the one the
    // acceptance certified is indistinguishable from a correct one afterwards.
    expect(() => run({ commit: 'b'.repeat(40), provenance: 'git', detail: '/ctx/msp/.git' }))
      .toThrow(/KI17_PIN_MISMATCH[\s\S]*expected a{40}[\s\S]*actual {3}b{40}/)
  })

  it('fails a context whose declared entrypoint is absent, rather than shipping a hole', () => {
    // A partial copy can carry the right .git and still be missing the file the
    // runtime configuration names — the server-line-worker.mjs failure mode.
    expect(() => run({ commit: 'a'.repeat(40), provenance: 'git', detail: 'x' }, () => false))
      .toThrow(/missing apps\/msp-server\/bin\/msp-server\.mjs/)
  })

  it('records an attested pin as attested, never as verified', () => {
    const receipt = run({ commit: 'a'.repeat(40), provenance: 'attested', detail: '/ctx/msp/.ki17-pin' })
    expect(receipt.contexts[0].provenance).toBe('attested')
  })

  it('refuses arguments it does not understand instead of checking nothing', () => {
    expect(() => parseArguments(['--manifest', 'p.json'])).toThrow(/at least one --context/)
    expect(() => parseArguments(['--context', 'msp'])).toThrow(/<name>=<dir>/)
  })
})

describe('the derived SmartGift benchmark (P-6)', () => {
  const corpus = JSON.parse(read('tests/fixtures/genesisrag17-smartgift-corpus-v1.json'))

  it('the acceptance corpus is NOT itself a valid worker fixture — which is why this exists', () => {
    // The worker validates a top-level `queries` array (validateBenchmarkFixture in
    // genesisrag17-worker/src/worker.mjs) and the corpus keeps its queries per record,
    // because the acceptance re-boots the worker once per benchmark entry. If this
    // assertion ever fails, the corpus grew a top-level queries array and the
    // derivation should be deleted rather than kept alongside it.
    expect(Array.isArray(corpus.queries)).toBe(false)
    expect(corpus.benchmarks.length).toBeGreaterThan(0)
  })

  it('derives the union of every record queries, in the shape the worker accepts', () => {
    const derived = deriveSmartgiftBenchmark(corpus, { sourceFile: 'corpus.json', sourceSha256: 'f'.repeat(64) })
    expect(typeof derived.fixtureVersion).toBe('string')
    expect(derived.queries.length).toBeGreaterThan(0)
    for (const row of derived.queries) {
      expect(typeof row.query).toBe('string')
      expect(row.query.trim()).not.toBe('')
      expect(row.relevantTexts.length).toBeGreaterThan(0)
      for (const text of row.relevantTexts) expect(typeof text).toBe('string')
    }
  })

  it('carries its own provenance, so a derived fixture never passes as a hand-written one', () => {
    const derived = deriveSmartgiftBenchmark(corpus, { sourceFile: 'corpus.json', sourceSha256: 'f'.repeat(64) })
    expect(derived.derived).toBe(true)
    expect(derived.derivedFrom).toMatchObject({ file: 'corpus.json', sha256: 'f'.repeat(64), benchmarkCount: corpus.benchmarks.length })
  })

  it('rejects a corpus whose benchmarks carry no queries instead of writing an empty fixture', () => {
    expect(() => deriveSmartgiftBenchmark({ fixtureVersion: 'v', benchmarks: [{ externalId: 'X' }] }))
      .toThrow(/KI17_BENCHMARK_CORPUS_INVALID/)
  })
})

describe('the runtime image copies every file the ki17 configuration names', () => {
  // The server-line-worker.mjs lesson: the runner image lists files one by one, so a
  // local import that is not listed passes the build, passes CI, and kills the
  // container on every restart. These are the ki17 equivalents.

  it('lists the smoke script and every repository file it imports, in the stage that ships it', () => {
    const stage = dockerfileStage(dockerfile, 'runner-ki17')
    const imports = [...smoke.matchAll(/^import .*? from '(\.[^']+)'/gm)].map((match) => match[1])
    // If the smoke script grows a second local import, this fails until the
    // Dockerfile copies it too.
    expect(imports).toEqual(['../src/modules/agent/msp-stdio-transport.js'])
    expect(stage).toMatch(/COPY --from=builder[^\n]*\/app\/scripts\/ki17-smoke\.mjs/)
    expect(stage).toMatch(/COPY --from=builder[^\n]*\/app\/src\/modules\/agent\/msp-stdio-transport\.js/)
  })

  it('adds nothing to the production `runner` stage, so a plain web deploy is byte-identical', () => {
    // The regression this whole shape exists to avoid. If /opt/ki17 ever appears in
    // `runner`, every `docker compose up -d --build web` starts needing three pinned
    // checkouts on disk, and a routine deploy of an unrelated change fails.
    expect(runnerStage(dockerfile)).not.toContain('/opt/ki17')
    expect(runnerStage(dockerfile)).not.toContain('ki17-smoke')
  })

  it('asserts every entrypoint the runtime configuration names actually exists in the image', () => {
    // `test -x` for the two the configuration EXECUTES, `test -f` for the rest.
    const executables = ['/opt/ki17/node/bin/node', '/opt/ki17/venv/bin/python']
    const files = [
      '/opt/ki17/msp/apps/msp-server/bin/msp-server.mjs',
      '/opt/ki17/gks/apps/gks-server/bin/gks-server.mjs',
      '/opt/ki17/genesisblock/genesisrag17-worker/src/cli.mjs',
      '/opt/ki17/genesisblock/index.linux-x64-gnu.node',
    ]
    for (const path of executables) expect(dockerfile, `Dockerfile must assert ${path} is executable`).toContain(`test -x ${path}`)
    for (const path of files) expect(dockerfile, `Dockerfile must assert ${path} exists`).toContain(`test -f ${path}`)
  })

  it('every executable path the env template names is one the Dockerfile asserts', () => {
    // The two files have to agree: a template naming a path the build never checks is
    // the exact shape of the runtime-image failure this project already paid for.
    for (const match of example.matchAll(/^(?:GENESISRAG17_PYTHON|ZURI_MSP_COMMAND|MSP_GKS_COMMAND|GENESIS_WORKER_MSP_COMMAND)=(\/\S+)$/gm)) {
      expect(dockerfile, `${match[1]} is named in .env.knowledge.example`).toContain(match[1])
    }
  })
})

describe('the compose service', () => {
  it('is behind the knowledge profile, so no ordinary `up` can start it', () => {
    expect(compose).toMatch(/genesis-worker:\n\s+profiles: \["knowledge"\]/)
  })

  it('joins web network namespace and publishes nothing', () => {
    // C5/C6: MSP posts only to an explicit loopback origin, and a container's
    // 127.0.0.1 is its own namespace. Publishing the port would also make it
    // reachable from the host, zuri-network and ngrok, which it must never be.
    const service = compose.slice(compose.indexOf('  genesis-worker:'), compose.indexOf('  ngrok:'))
    expect(service).toContain('network_mode: "service:web"')
    expect(service).not.toMatch(/^\s{4}ports:/m)
    expect(service).not.toMatch(/^\s{4}networks:/m)
    expect(service).toContain('stop_grace_period: 60s')
    expect(service).toContain('restart: unless-stopped')
    expect(service).toContain('driver: json-file')
  })

  it('declares the three named volumes and mounts ki17-state in both containers', () => {
    // C8: one filesystem with working file locks for msp.sqlite and gks.sqlite.
    const volumes = compose.slice(compose.lastIndexOf('\nvolumes:'))
    for (const name of ['ki17-state:', 'ki17-genesis-store:', 'ki17-model:']) expect(volumes).toContain(name)
    const web = compose.slice(compose.indexOf('  web:'), compose.indexOf('  # ADR-075 Phase 3 (P-4)'))
    expect(web).toContain('ki17-state:/var/lib/zuri-ki17/state')
    const worker = compose.slice(compose.indexOf('  genesis-worker:'), compose.indexOf('  ngrok:'))
    expect(worker).toContain('ki17-state:/var/lib/zuri-ki17/state')
    expect(worker).toContain('ki17-genesis-store:/var/lib/zuri-ki17/genesis')
    expect(worker).toContain('ki17-model:/opt/ki17/model:ro')
  })

  it('gives the worker .env.knowledge as its ONLY env file, and web it as an extra', () => {
    // §7: the worker must never receive web database, LINE or model credentials,
    // and the shared values must exist once rather than in two files that drift.
    const worker = compose.slice(compose.indexOf('  genesis-worker:'), compose.indexOf('  ngrok:'))
    const envFiles = [...worker.matchAll(/- path: (\S+)/g)].map((match) => match[1])
    expect(envFiles).toEqual(['.env.knowledge'])
    expect(worker).toMatch(/- path: \.env\.knowledge\n\s+required: true/)
    const web = compose.slice(compose.indexOf('  web:'), compose.indexOf('  # ADR-075 Phase 3 (P-4)'))
    expect([...web.matchAll(/- path: (\S+)/g)].map((match) => match[1])).toEqual(['.env', '.env.docker', '.env.knowledge'])
    expect(web).toMatch(/- path: \.env\.knowledge\n\s+required: false/)
  })

  it('leaves the web build block alone, so a routine web deploy needs no knowledge context', () => {
    // The regression this shape exists to prevent: making /opt/ki17 part of `runner`
    // would make every `docker compose up -d --build web` fail without the three
    // pinned checkouts on disk.
    const web = compose.slice(compose.indexOf('  web:'), compose.indexOf('  # ADR-075 Phase 3 (P-4)'))
    expect(web).toContain('target: runner')
    expect(web).not.toContain('additional_contexts')
    expect(dockerfile).toContain('FROM base AS runner')
  })
})

describe('the configuration template', () => {
  it('names every variable the design §7 table lists', () => {
    for (const name of [
      'ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'ZURI_KNOWLEDGE_TIMEOUT_MS',
      'ZURI_MSP_COMMAND', 'ZURI_MSP_ARGS', 'ZURI_MSP_CWD', 'ZURI_MSP_TIMEOUT_MS',
      'MSP_DB_PATH', 'GKS_DB_PATH',
      'MSP_GKS_COMMAND', 'MSP_GKS_ARGS', 'MSP_GKS_CWD',
      'MSP_PIPELINE_PRINCIPALS', 'MSP_GKS_PIPELINE_CREDENTIAL', 'GKS_PIPELINE_RELAY_CREDENTIAL',
      'MSP_PIPELINE_WORKER_URL', 'MSP_PIPELINE_WORKER_TOKEN',
      'GENESIS_WORKER_DB_PATH', 'GENESIS_WORKER_SCOPE', 'GENESIS_WORKER_CREDENTIAL',
      'GENESIS_WORKER_QUERY_TOKEN', 'GENESIS_WORKER_MODEL_DIR', 'GENESIS_WORKER_BENCHMARK_FIXTURE',
      'GENESIS_WORKER_PORT', 'GENESIS_WORKER_POLL_MS',
      'GENESIS_WORKER_MSP_COMMAND', 'GENESIS_WORKER_MSP_ARGS', 'GENESIS_WORKER_MSP_CWD', 'GENESIS_WORKER_MSP_TIMEOUT_MS',
      'GENESISRAG17_PYTHON',
    ]) {
      expect(example, `${name} is missing from .env.knowledge.example`).toMatch(new RegExp(`^${name}=`, 'm'))
    }
  })

  it('carries no value for anything secret', () => {
    // The file is committed. Paths and the port are configuration; a credential,
    // a scope object or a token never is.
    for (const name of [
      'MSP_PIPELINE_PRINCIPALS', 'MSP_GKS_PIPELINE_CREDENTIAL', 'GKS_PIPELINE_RELAY_CREDENTIAL',
      'MSP_PIPELINE_WORKER_TOKEN', 'GENESIS_WORKER_SCOPE', 'GENESIS_WORKER_CREDENTIAL',
      'GENESIS_WORKER_QUERY_TOKEN', 'ZURI_KNOWLEDGE_BINDINGS',
    ]) {
      expect(example, `${name} must be left empty in the template`).toMatch(new RegExp(`^${name}=$`, 'm'))
    }
  })

  it('warns about R-5 where ZURI_MSP_COMMAND is set, not somewhere else in the file', () => {
    // Setting ZURI_MSP_COMMAND turns MSP on for every caller, including the LINE
    // thread-memory scanner, which has no enable flag of its own. An operator has to
    // meet that sentence before they fill the value in, or the warning does nothing.
    const warning = example.indexOf('ZURI_MSP_THREAD_SERVICE_KEY')
    const setting = example.indexOf('\nZURI_MSP_COMMAND=')
    expect(warning).toBeGreaterThan(-1)
    expect(setting).toBeGreaterThan(warning)
    expect(example).toMatch(/R-5/)
    // Both thread-memory variables must be named as "leave unset" and never assigned.
    expect(example).not.toMatch(/^ZURI_MSP_THREAD_MEMORY_ENABLED=/m)
    expect(example).not.toMatch(/^ZURI_MSP_THREAD_SERVICE_KEY=/m)
  })

  it('points the worker fixture at a path the build actually bakes', () => {
    const fixture = /^GENESIS_WORKER_BENCHMARK_FIXTURE=(\S+)$/m.exec(example)[1]
    expect(fixture.startsWith('/opt/ki17/fixtures/')).toBe(true)
    expect(dockerfile).toContain(fixture.slice('/opt/ki17/fixtures/'.length))
    expect(dockerfile).toContain(`test -s ${fixture}`)
  })
})
