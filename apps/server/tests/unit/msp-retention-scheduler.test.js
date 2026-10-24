import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { buildCommands, releaseNames } from '../../scripts/build-ki17-overlay-release.mjs'
// @req FR-230 — shipped worker and guarded daily OS scheduling.
// @spec SEC-031, ADR-091
describe('MSP scheduler delivery', () => {
  it.runIf(process.platform === 'win32')('refuses an alternate recovery action before executing it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'msp-recovery-action-'))
    const recovery = path.resolve('scripts/reconcile-msp-retention-task.ps1'), action = path.resolve('scripts/invoke-msp-retention-task.ps1')
    const target = path.join(root, 'target.json'), stub = path.join(root, 'stub.ps1'), marker = path.join(root, 'executed')
    const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
    writeFileSync(stub, `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value 'unexpected'; exit 0`)
    writeFileSync(target, JSON.stringify({ ReconcileScriptSha256: sha(recovery), ScriptSha256: sha(action) }))
    try {
      const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', recovery, '-TargetFile', target, '-ActionScript', stub,
        '-RunId', '00000000-0000-4000-8000-000000000001', '-StoppedContainerId', 'a'.repeat(64)], { encoding: 'utf8', timeout: 15000 })
      expect(result.status).toBe(1)
      expect(existsSync(marker)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 20000)
  it('signs recovery claims on the host without emitting the private key', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'msp-host-sign-'))
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const keyPath = path.join(root, 'private.pem'), pem = privateKey.export({ format: 'pem', type: 'pkcs8' })
    writeFileSync(keyPath, pem)
    const claims = { runId: 'test-run', nonce: 'test-nonce', issuedAt: Date.now() }
    try {
      const result = spawnSync(process.execPath, ['scripts/sign-msp-retention-recovery.mjs', keyPath], { input: JSON.stringify(claims), encoding: 'utf8' })
      expect(result.status).toBe(0); expect(result.stdout).not.toContain(pem)
      const proof = JSON.parse(result.stdout)
      expect(verify(null, Buffer.from(JSON.stringify(claims)), publicKey, Buffer.from(proof.signature, 'base64url'))).toBe(true)
      expect(readFileSync('Dockerfile', 'utf8')).not.toMatch(/COPY[^\n]*sign-msp-retention-recovery\.mjs/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('the checked-in KI17 builder labels the exact source revision on both images', () => {
    const commit = 'a'.repeat(40)
    const commands = buildCommands({ ...releaseNames(commit), ki17From: 'qualified:previous' })
    for (const command of Object.values(commands)) expect(command).toContain(`org.opencontainers.image.revision=${commit}`)
    expect(() => buildCommands({ commit: 'short' })).toThrow('KI17_OVERLAY_SHA_INVALID')
  })
  it('ships both one-shot worker files in the runner image', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    expect(dockerfile).toMatch(/COPY[^\n]*server-msp-retention-worker\.mjs[^\n]*msp-retention-worker-run\.mjs/)
  })
  it('pins target project/service/revision/database/volume before executing by immutable ID', () => {
    const action = readFileSync('scripts/invoke-msp-retention-task.ps1', 'utf8')
    for (const marker of ['com.docker.compose.project', 'com.docker.compose.service', 'org.opencontainers.image.revision', 'StateVolume', 'DatabaseName', 'TenantScopeHash', 'ScriptSha256', 'CheckOnly']) expect(action).toContain(marker)
    expect(action).toContain("'exec', $container.Id, 'node', 'scripts/server-msp-retention-worker.mjs'")
    expect(action).not.toMatch(/Invoke-Expression|cmd \/c|compose exec/)
  })
  it('uses daily cadence, catch-up, no overlapping instances and preserves failures', () => {
    const registration = readFileSync('scripts/register-msp-retention-task.ps1', 'utf8')
    expect(registration).toContain("'03:00'")
    for (const marker of ['-Daily', '-StartWhenAvailable', '-MultipleInstances IgnoreNew', '-WhatIf', 'Interactive', 'CheckOnly']) expect(registration).toContain(marker)
    expect(registration).not.toContain('-Force')
    const action = readFileSync('scripts/invoke-msp-retention-task.ps1', 'utf8')
    expect(action).toContain('exit $workerExit')
  })
  it.runIf(process.platform === 'win32')('executes the actual PowerShell target guard and rejects same-name foreign databases', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'msp-task-'))
    const action = path.resolve('scripts/invoke-msp-retention-task.ps1')
    const sha = value => createHash('sha256').update(value).digest('hex')
    const scope = '{"tenant":"workspace"}', dbUrl = 'postgresql://runtime:synthetic-password@postgres:5432/zuri_retention_test'
    const inspectPath = path.join(root, 'container.json'), docker = path.join(root, 'docker.cmd'), target = path.join(root, 'target.json')
    writeFileSync(docker, `@echo off\r\ntype "${inspectPath}"\r\n`)
    const container = { Id: 'c'.repeat(64), Config: { Hostname: 'c'.repeat(12), Labels: { 'com.docker.compose.project': 'zuri-retention-test',
      'com.docker.compose.service': 'web', 'org.opencontainers.image.revision': 'a'.repeat(40) }, Env: [
      `DATABASE_URL=${dbUrl}`, `ZURI_MSP_RETENTION_TENANTS=${scope}`, 'MSP_DB_PATH=/var/lib/zuri-ki17/state/msp.sqlite', `ZURI_MSP_RETENTION_SWEEP_TOKEN=${'r'.repeat(40)}`] },
      State: { Status: 'running', Health: { Status: 'healthy' } }, Mounts: [{ Destination: '/var/lib/zuri-ki17/state', Type: 'volume', Name: 'zuri-retention-test_ki17-state', RW: true }] }
    writeFileSync(target, JSON.stringify({ SchemaVersion: 1, Project: 'zuri-retention-test', ContainerName: 'zuri-retention-test-web-1', AppRevision: 'a'.repeat(40),
      StateVolume: 'zuri-retention-test_ki17-state', DatabaseName: 'zuri_retention_test', DatabasePoolMode: 'session', DatabaseIdentityHash: sha(dbUrl), TenantScopeHash: sha(scope), ScriptSha256: sha(readFileSync(action)) }))
    const run = value => {
      writeFileSync(inspectPath, JSON.stringify([value]))
      const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', action, '-TargetFile', target, '-DockerExecutable', docker, '-CheckOnly'], { encoding: 'utf8', timeout: 10000 })
      expect(result.stdout).not.toContain('synthetic-password'); expect(result.stdout).not.toContain('r'.repeat(40))
      return result
    }
    try {
      const baseline = run(container)
      if (baseline.status !== 0) {
        // Synthetic-only diagnostic copy: never invoked against a live container.
        const diagnostic = path.join(root, 'diagnostic.ps1')
        writeFileSync(diagnostic, readFileSync(action, 'utf8').replace("Write-Output '{\"event\":\"msp.retention-task.failed\",\"ok\":false,\"error\":\"TARGET_OR_EXECUTION_FAILED\"}'", 'Write-Output $_.Exception.Message; Write-Output $_.ScriptStackTrace'))
        const cfg = JSON.parse(readFileSync(target, 'utf8')); cfg.ScriptSha256 = sha(readFileSync(diagnostic)); writeFileSync(target, JSON.stringify(cfg))
        const debug = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', diagnostic, '-TargetFile', target, '-DockerExecutable', docker, '-CheckOnly'], { encoding: 'utf8', timeout: 10000 })
        throw new Error(`SYNTHETIC_TARGET_GUARD_FAILED: ${debug.stdout} ${debug.stderr}`)
      }
      expect(baseline.status).toBe(0)
      for (const mutate of [c => { c.Config.Env[0] = c.Config.Env[0].replace('@postgres:', '@different-host:') },
        c => { c.Config.Labels['com.docker.compose.project'] = 'foreign' }, c => { c.Config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40) },
        c => { c.Mounts[0].Name = 'other_ki17-state' }]) {
        const copy = structuredClone(container); mutate(copy); expect(run(copy).status).toBe(1)
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30000)
})
