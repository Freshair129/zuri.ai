// @req FR-267 — secure opt-in topology and exact TLS configuration guards.
// @spec ADR-099 D10, ADR-100 D7
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { checkConfig } from '../../deploy/private-runtime/check-config.mjs'

const fixtures = new URL('../../../../services/conversation-runtime/test/fixtures/prp-tls/', import.meta.url)
const publicTestCert = readFileSync(new URL('TEST-ONLY-cert.pem', fixtures))
const publicTestKey = readFileSync(new URL('TEST-ONLY-key.pem', fixtures))
let cert, key, certificateDirectory
beforeAll(() => {
  certificateDirectory = mkdtempSync(path.join(tmpdir(), 'zuri-prp-config-'))
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Isolated configuration test',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'subjectAltName=IP:10.246.99.10',
    '-keyout', path.join(certificateDirectory, 'key.pem'), '-out', path.join(certificateDirectory, 'cert.pem')], { stdio: 'ignore', windowsHide: true })
  cert = readFileSync(path.join(certificateDirectory, 'cert.pem'))
  key = readFileSync(path.join(certificateDirectory, 'key.pem'))
})
afterAll(() => { if (certificateDirectory?.startsWith(path.join(tmpdir(), 'zuri-prp-config-'))) rmSync(certificateDirectory, { recursive: true, force: true }) })
const env = { ZURI_PRP_TLS_IMAGE: `nginx@sha256:${'a'.repeat(64)}`, ZURI_PRP_UPSTREAM_ADDRESS: '10.246.100.11:4443',
  ZURI_PRP_UPSTREAM_TLS_NAME: 'localhost', ZURI_PRP_NETWORK: 'isolated-prp', ZURI_PRP_TLS_KEY_FILE: 'key' }
const read = file => file === 'key' ? key : cert

describe('private runtime deployment', () => {
  it('admits only a matching fixed IP SAN, CA and private key configuration', () => {
    expect(checkConfig(env, { read })).toMatchObject({ proxyIP: '10.246.99.10', upstreamIP: '10.246.100.11' })
    expect(() => checkConfig({ ...env, ZURI_PRP_TLS_IP: '10.246.99.20' }, { read })).toThrow('PRP_TLS_IDENTITY_INVALID')
    expect(() => checkConfig(env, { read: () => 'not a certificate' })).toThrow('PRP_TLS_IDENTITY_INVALID')
  })
  it('never admits the committed public test TLS identity for deployment', () => {
    expect(() => checkConfig(env, { read: file => file === 'key' ? publicTestKey : publicTestCert })).toThrow('PRP_TEST_CERTIFICATE_FORBIDDEN')
  })
  it.each([{ ZURI_PRP_TLS_IMAGE: 'nginx:latest' }, { ZURI_PRP_TLS_IP: '169.254.169.254' },
    { ZURI_PRP_UPSTREAM_ADDRESS: 'litellm:4000' }, { ZURI_PRP_UPSTREAM_ADDRESS: '169.254.169.254:443' },
    { ZURI_PRP_UPSTREAM_TLS_NAME: 'host; injected' }, { ZURI_PRP_NETWORK: '' }])('refuses unsafe/unpinned deployment config %j', change => {
    expect(() => checkConfig({ ...env, ...change }, { read })).toThrow()
  })
  it('keeps only Zuri integration services and no published inference or database ports', () => {
    const compose = parse(readFileSync(new URL('../../docker-compose.private-runtime.yml', import.meta.url), 'utf8'))
    expect(Object.keys(compose.services).sort()).toEqual(['conversation-runtime', 'prp-tls', 'web'])
    expect(compose.networks['prp-client'].internal).toBe(true)
    expect(compose.networks['prp-upstream'].external).toBe(true)
    for (const service of Object.values(compose.services)) expect(service.ports).toBeUndefined()
    for (const name of ['web', 'conversation-runtime']) {
      expect(compose.services[name].environment.NODE_EXTRA_CA_CERTS).toBe('/run/secrets/prp_client_ca')
      expect(compose.services[name].secrets).toEqual(['prp_client_ca'])
    }
    const proxy = readFileSync(new URL('../../deploy/private-runtime/prp.conf.template', import.meta.url), 'utf8')
    expect(proxy).toContain('proxy_ssl_verify on;')
    expect(proxy).toContain('location = /v1/models')
    expect(proxy).toContain('location = /v1/chat/completions')
    expect(proxy).toContain('location / { return 404; }')
  })
  it('resolves every disposable development bind to an existing repository path', () => {
    const directory = fileURLToPath(new URL('../../deploy/private-runtime/', import.meta.url))
    const dev = parse(readFileSync(path.join(directory, 'compose.dev.yml'), 'utf8'))
    for (const service of Object.values(dev.services)) {
      expect(service.ports).toBeUndefined()
      for (const mount of service.volumes ?? []) expect(existsSync(path.resolve(directory, mount.split(':')[0]))).toBe(true)
    }
  })
})
