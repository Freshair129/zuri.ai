// @req FR-289 — verify the local-only, read-only documentation deployment boundary.
// @tested tests/unit/knowledge-studio/docker-runtime.test.js

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const compose = parse(readFileSync(path.join(serverRoot, 'docker-compose.yml'), 'utf8'))
const web = compose.services.web
const ngrok = compose.services.ngrok

describe('Knowledge Studio Docker runtime data', () => {
  it('sets one explicit data root and mounts canonical sources read-only', () => {
    expect(web.environment.ZURI_KNOWLEDGE_STUDIO_ROOT).toBe('/app/knowledge-studio-data')
    expect(web.volumes).toContain('../../docs:/app/knowledge-studio-data/docs:ro')
    expect(web.volumes).toContain(
      '../../registry/document-registry/index.json:/app/knowledge-studio-data/registry/document-registry/index.json:ro',
    )
  })

  it('keeps public ingress opt-in and requires an assigned domain at runtime', () => {
    expect(ngrok.profiles).toContain('public')
    expect(ngrok.environment.NGROK_DOMAIN).toBe('${NGROK_DOMAIN:-}')
    expect(ngrok.command.join(' ')).toContain('NGROK_AUTHTOKEN')
    expect(ngrok.command.join(' ')).toContain('NGROK_DOMAIN')
    expect(ngrok.command.join(' ')).toContain('ngrok public profile requires NGROK_AUTHTOKEN and an assigned NGROK_DOMAIN')
  })

  it('makes local-only the default in both deploy wrappers', () => {
    const powershell = readFileSync(path.join(serverRoot, 'scripts/deploy.ps1'), 'utf8')
    const bash = readFileSync(path.join(serverRoot, 'scripts/deploy.sh'), 'utf8')
    expect(powershell).toContain('docker compose @composeOptions --profile public up -d --remove-orphans')
    expect(powershell).toContain('docker compose @composeOptions up -d --remove-orphans web')
    expect(powershell).toContain('docker compose @composeOptions config --environment')
    expect(powershell).toContain('resolved Compose environment')
    expect(powershell).toContain("Get-ResolvedComposeValue 'COMPOSE_PROFILES'")
    expect(powershell).toContain("$activeProfiles -contains 'public'")
    expect(powershell).toContain("[string]$EnvironmentFile = '.env'")
    expect(powershell).toContain("$composeOptions = @('--env-file', $environmentPath)")
    expect(powershell).toContain("$composeOptions += @('--project-name', $ProjectName)")
    expect(powershell).toContain("Get-ResolvedComposeValue 'ZURI_WEB_ENV_FILE'")
    expect(powershell).toContain('custom -EnvironmentFile must set ZURI_WEB_ENV_FILE')
    expect(powershell).toContain('ZURI_WEB_DOCKER_ENV_FILE\\s*=')
    expect(powershell).toContain("Get-ResolvedComposeValue 'ZURI_WEB_IMAGE'")
    expect(powershell).toContain("Get-ResolvedComposeValue 'ZURI_TOOLS_IMAGE'")
    expect(powershell).toContain("'ngrok-url.ps1') -Port $inspectPort")
    const runtimeEnvGuard = powershell.indexOf('A custom -EnvironmentFile must set ZURI_WEB_ENV_FILE')
    const composeEnvironmentResolution = powershell.indexOf('docker compose @composeOptions config --environment')
    expect(runtimeEnvGuard).toBeGreaterThanOrEqual(0)
    expect(runtimeEnvGuard).toBeLessThan(composeEnvironmentResolution)
    expect(bash).toContain('docker compose --profile public up -d --remove-orphans')
    expect(bash).toContain('docker compose up -d --remove-orphans web')
    expect(bash).toContain('docker compose config --environment')
    expect(bash).toContain('resolved Compose environment')
    expect(bash).toContain('resolved_compose_value COMPOSE_PROFILES')
    expect(bash).toContain('== *,public,*')
  })

  it('creates the registry mount target and refreshes the ignored graph in both deploy scripts', () => {
    const dockerfile = readFileSync(path.join(serverRoot, 'Dockerfile'), 'utf8')
    const runnerStart = dockerfile.indexOf('FROM base AS runner')
    const runnerEnd = dockerfile.indexOf('FROM runner AS runner-ki17', runnerStart)
    const runner = dockerfile.slice(runnerStart, runnerEnd)
    expect(runner).toContain('mkdir -p /app/knowledge-studio-data/registry/document-registry')

    const powershell = readFileSync(path.join(serverRoot, 'scripts/deploy.ps1'), 'utf8')
    const bash = readFileSync(path.join(serverRoot, 'scripts/deploy.sh'), 'utf8')
    const powershellGraph = powershell.match(/^npm run docs:graph$/m)?.index ?? -1
    const powershellBuild = powershell.match(/^  docker compose @composeOptions build$/m)?.index ?? -1
    const bashGraph = bash.match(/^npm --prefix .* run docs:graph$/m)?.index ?? -1
    const bashBuild = bash.match(/^  docker compose build$/m)?.index ?? -1
    expect(powershellGraph).toBeGreaterThanOrEqual(0)
    expect(powershellBuild).toBeGreaterThanOrEqual(0)
    expect(powershellGraph).toBeLessThan(powershellBuild)
    expect(bashGraph).toBeGreaterThanOrEqual(0)
    expect(bashBuild).toBeGreaterThanOrEqual(0)
    expect(bashGraph).toBeLessThan(bashBuild)
  })
})
