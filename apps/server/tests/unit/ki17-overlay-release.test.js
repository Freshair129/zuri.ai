import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ENV_VAR,
  RECREATE_COMMANDS,
  SMOKE_COMMAND,
  assertReleasable,
  buildCommands,
  deployPlan,
  deployRelease,
  parseArguments,
  readEnvVar,
  releaseNames,
  replaceEnvVar,
} from '../../scripts/build-ki17-overlay-release.mjs'

// @req FR-187 — the GenesisRAG17 web image ships with the pinned /opt/ki17 tree;
//   a production release carries the running tree forward as an overlay.
// @spec docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md, apps/server/deploy/ki17/README.md
// @tested tests/unit/ki17-overlay-release.test.js

const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8')
const SHA = '05f3567d35398fc1705489c249210fc4b3660d50'

describe('release naming', () => {
  it('names the base and release tags from the first 8 hex of the commit', () => {
    expect(releaseNames(SHA)).toEqual({
      commit: SHA,
      short: '05f3567d',
      baseTag: 'zuri-ai-web:main-05f3567d',
      releaseTag: 'zuri-ai-web-ki17:release-05f3567d-ki17-overlay',
    })
  })

  it('refuses anything that is not a full commit', () => {
    expect(() => releaseNames('05f3567d')).toThrow(/KI17_OVERLAY_SHA_INVALID/)
    expect(() => releaseNames('')).toThrow(/KI17_OVERLAY_SHA_INVALID/)
  })
})

describe('reading and writing the one .env variable', () => {
  const env = ['DATABASE_URL=postgres://secret', 'ZURI_WEB_IMAGE=zuri-ai-web-ki17:release-fad8ec62-ki17-overlay', 'NGROK_AUTHTOKEN=secret', ''].join('\r\n')

  it('reads ZURI_WEB_IMAGE and nothing else', () => {
    expect(readEnvVar(env, ENV_VAR)).toBe('zuri-ai-web-ki17:release-fad8ec62-ki17-overlay')
    expect(readEnvVar('ZURI_WEB_IMAGE="a:b"\n', ENV_VAR)).toBe('a:b')
    expect(readEnvVar('# ZURI_WEB_IMAGE=x:y\n', ENV_VAR)).toBeNull()
    expect(readEnvVar('OTHER=1\n', ENV_VAR)).toBeNull()
    expect(readEnvVar('ZURI_WEB_IMAGE=\n', ENV_VAR)).toBeNull()
  })

  it('replaces only that line and keeps every other line and the EOL byte-for-byte', () => {
    const next = replaceEnvVar(env, ENV_VAR, 'zuri-ai-web-ki17:release-05f3567d-ki17-overlay')
    expect(next).toBe(env.replace('release-fad8ec62', 'release-05f3567d'))
  })

  it('appends the variable when the file has none, and refuses a value that is not an image reference', () => {
    expect(replaceEnvVar('A=1\n', ENV_VAR, 'x:y')).toBe('A=1\nZURI_WEB_IMAGE=x:y\n')
    expect(() => replaceEnvVar('A=1\n', ENV_VAR, 'x:y\nEVIL=1')).toThrow(/KI17_OVERLAY_IMAGE_INVALID/)
  })
})

describe('refusals before any build', () => {
  const ok = {
    dirty: false,
    currentImage: 'zuri-ai-web-ki17:release-fad8ec62-ki17-overlay',
    ki17From: 'zuri-ai-web-ki17:release-fad8ec62-ki17-overlay',
    ki17FromExists: true,
    releaseTag: 'zuri-ai-web-ki17:release-05f3567d-ki17-overlay',
  }

  it('accepts a clean tree whose running image exists', () => {
    expect(() => assertReleasable(ok)).not.toThrow()
  })

  it('refuses a dirty tree', () => {
    expect(() => assertReleasable({ ...ok, dirty: true })).toThrow(/KI17_OVERLAY_DIRTY_TREE/)
  })

  it('refuses when there is no running image to carry /opt/ki17 from, or it is not present locally', () => {
    expect(() => assertReleasable({ ...ok, currentImage: null, ki17From: null })).toThrow(/KI17_OVERLAY_NO_CURRENT_IMAGE/)
    expect(() => assertReleasable({ ...ok, ki17FromExists: false })).toThrow(/KI17_OVERLAY_KI17_FROM_MISSING/)
  })

  it('refuses to release the image that is already current unless KI17_FROM was named explicitly', () => {
    const same = { ...ok, currentImage: ok.releaseTag, ki17From: ok.releaseTag }
    expect(() => assertReleasable(same)).toThrow(/KI17_OVERLAY_ALREADY_CURRENT/)
    expect(() => assertReleasable({ ...same, explicitKi17From: true })).not.toThrow()
  })

  it('refuses a ZURI_WEB_IMAGE that is not a zuri-ai web image', () => {
    expect(() => assertReleasable({ ...ok, currentImage: 'postgres:16' })).toThrow(/KI17_OVERLAY_CURRENT_IMAGE_UNEXPECTED/)
  })
})

describe('the build and deploy commands', () => {
  it('builds plain runner, then the overlay from the committed Dockerfile with BASE and KI17_FROM', () => {
    const commands = buildCommands({ baseTag: 'zuri-ai-web:main-05f3567d', releaseTag: 'r:1', ki17From: 'k:0' })
    expect(commands.runner).toEqual(['docker', 'build', '--target', 'runner', '-t', 'zuri-ai-web:main-05f3567d', '.'])
    expect(commands.overlay).toEqual(['docker', 'build', '-f', 'deploy/ki17/overlay/Dockerfile', '--build-arg', 'BASE=zuri-ai-web:main-05f3567d', '--build-arg', 'KI17_FROM=k:0', '-t', 'r:1', '.'])
  })

  it('recreates web and line-worker, force-recreates genesis-worker, and smokes both hops', () => {
    expect(RECREATE_COMMANDS[0]).toEqual(['docker', 'compose', 'up', '-d', '--no-build', 'web', 'line-worker'])
    expect(RECREATE_COMMANDS[1]).toContain('--force-recreate')
    expect(RECREATE_COMMANDS[1]).toContain('genesis-worker')
    expect(SMOKE_COMMAND.join(' ')).toContain('exec -T web node')
    expect(SMOKE_COMMAND.join(' ')).toContain('scripts/ki17-smoke.mjs')
  })

  it('prints a plan naming the new image and the rollback image, and nothing from .env', () => {
    const plan = deployPlan({ releaseTag: 'zuri-ai-web-ki17:release-05f3567d-ki17-overlay', previousImage: 'zuri-ai-web-ki17:release-fad8ec62-ki17-overlay' })
    expect(plan).toContain('ZURI_WEB_IMAGE=zuri-ai-web-ki17:release-05f3567d-ki17-overlay')
    expect(plan).toContain('ROLLBACK')
    expect(plan).toContain('ZURI_WEB_IMAGE=zuri-ai-web-ki17:release-fad8ec62-ki17-overlay')
    expect(plan).not.toMatch(/DATABASE_URL|TOKEN|SECRET/)
  })

  it('accepts only the documented flags', () => {
    expect(parseArguments(['--deploy', '--ki17-from', 'a:b', '--skip-runner-build'])).toEqual({ deploy: true, ki17From: 'a:b', skipRunnerBuild: true })
    expect(parseArguments([])).toEqual({ deploy: false, ki17From: null, skipRunnerBuild: false })
    expect(() => parseArguments(['--force'])).toThrow(/KI17_OVERLAY_ARGS_INVALID/)
    expect(() => parseArguments(['--ki17-from'])).toThrow(/KI17_OVERLAY_ARGS_INVALID/)
  })
})

describe('--deploy rolls back on a failed health check or smoke', () => {
  const previousImage = 'zuri-ai-web-ki17:release-fad8ec62-ki17-overlay'
  const releaseTag = 'zuri-ai-web-ki17:release-05f3567d-ki17-overlay'
  const fakeOps = ({ healthy = [true], smoke = [0] } = {}) => {
    const state = { env: `A=1\nZURI_WEB_IMAGE=${previousImage}\n`, backup: null, ran: [], logs: [] }
    const health = [...healthy]
    const smokes = [...smoke]
    return {
      state,
      ops: {
        readEnv: () => state.env,
        writeEnv: (text) => { state.env = text },
        backupEnv: () => { state.backup = state.env; return '.env.bak' },
        restoreEnv: () => { state.env = state.backup },
        run: (argv) => {
          state.ran.push(argv.join(' '))
          return argv === SMOKE_COMMAND ? (smokes.shift() ?? 0) : 0
        },
        waitHealthy: async () => health.shift() ?? true,
        log: (line) => state.logs.push(line),
      },
    }
  }

  it('switches the one variable and succeeds when health and smoke pass', async () => {
    const { state, ops } = fakeOps()
    const result = await deployRelease({ releaseTag, previousImage, ops })
    expect(result).toMatchObject({ ok: true, rolledBack: false })
    expect(state.env).toBe(`A=1\nZURI_WEB_IMAGE=${releaseTag}\n`)
    expect(state.ran.filter((line) => line.includes('--force-recreate genesis-worker'))).toHaveLength(1)
  })

  it('restores .env and recreates the previous image when the smoke fails', async () => {
    const { state, ops } = fakeOps({ smoke: [1, 0] })
    const result = await deployRelease({ releaseTag, previousImage, ops })
    expect(result).toMatchObject({ ok: false, rolledBack: true, failure: 'ki17-smoke failed' })
    expect(state.env).toBe(`A=1\nZURI_WEB_IMAGE=${previousImage}\n`)
    expect(state.ran.filter((line) => line.includes('--force-recreate genesis-worker'))).toHaveLength(2)
  })

  it('restores .env when web never becomes healthy, and says so when the rollback fails too', async () => {
    const { state, ops } = fakeOps({ healthy: [false, false] })
    const result = await deployRelease({ releaseTag, previousImage, ops })
    expect(result).toMatchObject({ ok: false, rolledBack: false, failure: 'web did not become healthy' })
    expect(state.env).toContain(previousImage)
    expect(state.logs.join('\n')).toContain('ROLLBACK ALSO FAILED')
  })
})

describe('the committed overlay Dockerfile', () => {
  const overlay = read('deploy/ki17/overlay/Dockerfile')

  it('takes BASE and KI17_FROM and copies /opt/ki17 plus exactly the files runner-ki17 adds', () => {
    expect(overlay).toMatch(/^ARG BASE$/m)
    expect(overlay).toMatch(/^ARG KI17_FROM$/m)
    expect(overlay).toContain('FROM ${KI17_FROM} AS ki17src')
    expect(overlay).toContain('COPY --from=ki17src --chown=node:node /opt/ki17 /opt/ki17')
    for (const file of ['scripts/ki17-smoke.mjs', 'src/modules/agent/msp-stdio-transport.js', 'src/modules/agent/msp-child-environment.mjs']) {
      expect(overlay).toContain(file)
      expect(overlay, `${file} must be asserted`).toContain(`test -f /app/${file}`)
    }
    expect(overlay).toMatch(/USER node\s*$/)
  })

  it('asserts the carried tree and refuses a KI17_FROM built from the HTTP canary manifest', () => {
    for (const path of ['/opt/ki17/msp/apps/msp-server/bin/msp-server.mjs', '/opt/ki17/gks/apps/gks-server/bin/gks-server.mjs']) {
      expect(overlay).toContain(`test -f ${path}`)
    }
    expect(overlay).toContain('test -x /opt/ki17/node/bin/node')
    expect(overlay).toContain('test -s /opt/ki17/pins/resolved.json')
    expect(overlay).toContain('KI17_OVERLAY_PROFILE_REFUSED')
  })
})
