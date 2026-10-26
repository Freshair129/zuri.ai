// @spec ADR-115 — local daemon, exact owned TEST resources, no shell, pull, prune or deletion.
// @tested tests/node/compact-executor.test.mjs, tests/postgres/compact-fresh-install.test.js
import { spawn } from 'node:child_process'
import { CompactError, validateCompactManifest } from './manifest.mjs'
import { validateCompactTarget, assertCompactResources, compactOwnerLabels, planCompactInstall } from './target.mjs'
import { digest, stableJson } from './files.mjs'
import { COMPACT_DATABASE_INSPECTION, compactInitializationSql } from './database.mjs'
const fail = code => { throw new CompactError(code) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export function compactProcessEnvironment(extra = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR'].includes(k.toUpperCase()))), ...extra }
}
export async function runCompactDocker(args, { input = '', environment = {}, timeoutMs = 30000 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { shell: false, windowsHide: true, env: compactProcessEnvironment(environment), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', settled = false
    const stop = () => { if (!settled) { settled = true; child.kill(); reject(new CompactError('COMPACT_DOCKER_FAILED')) } }
    const timer = setTimeout(stop, timeoutMs)
    child.stdout.on('data', bytes => { stdout += bytes; if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) stop() })
    child.stderr.on('data', bytes => { stderr += bytes; if (Buffer.byteLength(stderr) > 1024 * 1024) stop() })
    child.once('error', stop); child.stdin.on('error', () => {})
    child.once('close', status => { clearTimeout(timer); if (!settled) { settled = true; resolve({ status, stdout, stderr }) } })
    child.stdin.end(input)
  })
}
export function createCompactDockerDriver({ run = runCompactDocker } = {}) {
  const invoke = async (endpoint, args, options) => {
    const result = await run(['--host', endpoint, ...args], options)
    if (result.status !== 0) fail('COMPACT_DOCKER_FAILED')
    return result.stdout.trim()
  }
  const read = async (endpoint, kind, name) => {
    const result = await run(['--host', endpoint, kind, 'inspect', name])
    if (result.status !== 0) {
      if (/No such (?:volume|network|container|image|object)|(?:volume|network|container|image).+not found/i.test(result.stderr)) return null
      fail('COMPACT_DOCKER_FAILED')
    }
    try { const parsed = JSON.parse(result.stdout); if (!Array.isArray(parsed) || parsed.length !== 1) fail('COMPACT_DOCKER_FAILED'); return parsed[0] } catch { fail('COMPACT_DOCKER_FAILED') }
  }
  const local = async target => {
    const result = await run(['--context', target.dockerContext, 'context', 'inspect', target.dockerContext])
    if (result.status !== 0) fail('COMPACT_DOCKER_UNAVAILABLE')
    let endpoint
    try { endpoint = JSON.parse(result.stdout)[0].Endpoints.docker.Host } catch { fail('COMPACT_DOCKER_UNAVAILABLE') }
    if (typeof endpoint !== 'string' || !/^(?:npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+|unix:\/\/\/[^\x00\r\n?#]+)$/.test(endpoint)) fail('COMPACT_DOCKER_REMOTE_REFUSED')
    const raw = await invoke(endpoint, ['info', '--format', '{{json .ID}}'])
    let id; try { id = JSON.parse(raw) } catch { fail('COMPACT_DOCKER_UNAVAILABLE') }
    if (typeof id !== 'string' || !id) fail('COMPACT_DOCKER_UNAVAILABLE')
    return { context: target.dockerContext, endpoint, id }
  }
  const psql = async (endpoint, target, containerId, sql, { runtimePassword, initializePassword, atomic = false } = {}) => {
    const environment = {}, args = ['container', 'exec', '--interactive']
    if (runtimePassword) { args.push('--env', 'PGPASSWORD'); environment.PGPASSWORD = runtimePassword }
    if (initializePassword) { args.push('--env', 'COMPACT_RUNTIME_PASSWORD'); environment.COMPACT_RUNTIME_PASSWORD = initializePassword }
    args.push(containerId, 'psql', '-X', '--no-password', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--username', runtimePassword ? target.database.runtimeRole : target.database.bootstrapRole, '--dbname', target.database.name)
    if (runtimePassword) args.push('--host', '127.0.0.1')
    if (atomic) args.push('--single-transaction')
    args.push('--file', '-')
    return invoke(endpoint, args, { input: sql, environment, timeoutMs: atomic ? 120000 : 15000 })
  }
  const driver = {
    async inspect({ manifest, target }) {
      const m = validateCompactManifest(manifest), t = validateCompactTarget(target), daemon = await local(t)
      const images = {}, cache = new Map()
      for (const [key, reference] of Object.entries(m.images)) {
        if (!cache.has(reference)) cache.set(reference, read(daemon.endpoint, 'image', reference))
        const image = await cache.get(reference)
        images[key] = image && image.RepoDigests?.includes(reference) ? { reference, id: image.Id, platform: `${image.Os}/${image.Architecture}` } : null
      }
      const volumes = {}
      for (const [key, name] of Object.entries(t.volumes)) {
        const v = await read(daemon.endpoint, 'volume', name)
        volumes[key] = v ? { name: v.Name, driver: v.Driver, labels: v.Labels || {}, created: v.CreatedAt || '' } : null
      }
      const n = await read(daemon.endpoint, 'network', t.network), c = await read(daemon.endpoint, 'container', t.database.container)
      const ports = c?.State?.Running ? c.NetworkSettings?.Ports?.['5432/tcp'] : c?.HostConfig?.PortBindings?.['5432/tcp'], networks = Object.keys(c?.NetworkSettings?.Networks || {})
      const observed = { daemon, images, volumes, network: n ? { id: n.Id, name: n.Name, driver: n.Driver, labels: n.Labels || {}, subnet: n.IPAM?.Config?.length === 1 ? n.IPAM.Config[0].Subnet : '' } : null,
        container: c ? { id: c.Id, name: c.Name.replace(/^\//, ''), reference: c.Config.Image, imageId: c.Image, running: c.State.Running, labels: c.Config.Labels || {}, mounts: c.Mounts.map(v => ({ type: v.Type, name: v.Name || '', destination: v.Destination })), network: networks.length === 1 ? networks[0] : '', host: ports?.length === 1 ? ports[0].HostIp : '', port: ports?.length === 1 ? Number(ports[0].HostPort) : 0, created: c.Created,
          safeConfiguration: c.HostConfig.Privileged === false && !c.HostConfig.AutoRemove && !c.HostConfig.PidMode && !c.HostConfig.CapAdd?.length && !c.HostConfig.Devices?.length && !c.HostConfig.Binds?.length } : null,
        database: null }
      // Return refused facts without connecting to an unowned/mismatched DB.
      try { assertCompactResources(t, m, observed) } catch (e) { if (e instanceof CompactError) return observed; throw e }
      if (!observed.container?.running) return observed
      try {
        const row = JSON.parse(await psql(daemon.endpoint, t, c.Id, COMPACT_DATABASE_INSPECTION))
        const marker = row.markerExists ? JSON.parse(await psql(daemon.endpoint, t, c.Id, 'SELECT payload::text FROM zuri_compact.installation WHERE singleton=true;')) : null
        delete row.markerExists
        observed.database = { ...row, installation: marker }
      } catch { fail('COMPACT_DATABASE_UNAVAILABLE') }
      return observed
    },
    async create({ manifest, target, credentials }) {
      const t = validateCompactTarget(target), m = validateCompactManifest(manifest), before = await driver.inspect({ manifest: m, target: t })
      if (planCompactInstall({ manifest: m, target: t, observed: before }).action !== 'CREATE_AND_INITIALIZE') fail('COMPACT_TARGET_EXISTS')
      const labels = Object.entries(compactOwnerLabels(t)).flatMap(([key, value]) => ['--label', `${key}=${value}`]), endpoint = before.daemon.endpoint
      for (const name of Object.values(t.volumes)) {
        await invoke(endpoint, ['volume', 'create', '--driver', 'local', ...labels, name])
        const v = await read(endpoint, 'volume', name)
        if (!v || v.Driver !== 'local' || Object.entries(compactOwnerLabels(t)).some(([k, value]) => v.Labels?.[k] !== value)) fail('COMPACT_FOREIGN_RESOURCE')
      }
      await invoke(endpoint, ['network', 'create', '--driver', 'bridge', '--subnet', t.networkSubnet, ...labels, t.network])
      const n = await read(endpoint, 'network', t.network)
      if (!n || Object.entries(compactOwnerLabels(t)).some(([k, v]) => n.Labels?.[k] !== v)) fail('COMPACT_FOREIGN_RESOURCE')
      const id = await invoke(endpoint, ['container', 'create', '--name', t.database.container, '--pull', 'never', '--platform', m.platform, ...labels, '--label', `com.docker.compose.project=${t.project}`, '--label', 'com.docker.compose.service=db', '--network', t.network, '--publish', `127.0.0.1:${t.database.port}:5432`, '--mount', `type=volume,source=${t.volumes.database},target=/var/lib/postgresql/data`, '--env', 'POSTGRES_USER', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB', m.images.postgres], { environment: { POSTGRES_USER: t.database.bootstrapRole, POSTGRES_PASSWORD: credentials.bootstrapPassword, POSTGRES_DB: t.database.name } })
      if (!/^[a-f0-9]{64}$/.test(id)) fail('COMPACT_DOCKER_FAILED')
      const created = await read(endpoint, 'container', id)
      if (!created || Object.entries(compactOwnerLabels(t)).some(([k, v]) => created.Config?.Labels?.[k] !== v)) fail('COMPACT_FOREIGN_RESOURCE')
      await invoke(endpoint, ['container', 'start', id])
      const deadline = Date.now() + 45000
      while (Date.now() < deadline) {
        try { const ready = await driver.inspect({ manifest: m, target: t }); planCompactInstall({ manifest: m, target: t, observed: ready }); return ready }
        catch (error) { if (error.code !== 'COMPACT_DATABASE_UNAVAILABLE') throw error; await pause(250) }
      }
      fail('COMPACT_DATABASE_UNAVAILABLE')
    },
    async apply({ manifest, target, observed, baseline, credentials }) {
      const current = await driver.inspect({ manifest, target })
      if (digest(stableJson(current)) !== digest(stableJson(observed))) fail('COMPACT_OBSERVATION_CHANGED')
      if (planCompactInstall({ manifest, target, observed: current }).action !== 'INITIALIZE') fail('COMPACT_DATABASE_NOT_EMPTY')
      try { await psql(current.daemon.endpoint, target, current.container.id, compactInitializationSql({ manifest, target, observed: current, baseline }), { initializePassword: credentials.runtimePassword, atomic: true }) }
      catch { fail('COMPACT_INITIALIZATION_FAILED') }
    },
    async stop({ manifest, target }) {
      const observed = await driver.inspect({ manifest, target }); assertCompactResources(target, manifest, observed)
      if (!observed.container) fail('COMPACT_TARGET_UNAVAILABLE')
      if (observed.container.running) await invoke(observed.daemon.endpoint, ['container', 'stop', '--time', '20', observed.container.id])
      return { status: 'STOPPED', project: target.project, targetId: target.targetId }
    },
  }
  return driver
}
