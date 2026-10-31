// @req FR-267 — fail closed before starting the operator-owned TLS integration.
// @spec ADR-099 D10, SEC-030
// @tested tests/unit/private-runtime-deployment.test.js
import { X509Certificate, createPrivateKey, createPublicKey, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const fail = code => { throw new Error(code) }
// The committed fixture key is public. Even a reissued certificate using this
// key must never pass a real deployment preflight.
const PUBLIC_TEST_SPKI = 'abf8591e2e9ff2138c873f0ee3d6191d69207f0aa91cdcdc65b9988d3be6c8f1'
export function checkConfig(env, { read = readFileSync } = {}) {
  const ip = env.ZURI_PRP_TLS_IP || '10.246.99.10'
  const image = env.ZURI_PRP_TLS_IMAGE
  if (!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image ?? '')) fail('PRP_IMAGE_DIGEST_REQUIRED')
  const safeIP = value => isIP(value) === 4 && !/^(?:0|127|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(value) && value !== '100.100.100.200'
  if (!safeIP(ip)) fail('PRP_FIXED_IP_REQUIRED')
  const match = env.ZURI_PRP_UPSTREAM_ADDRESS?.match(/^([0-9.]+):([0-9]+)$/)
  if (!match || !safeIP(match[1]) || +match[2] < 1 || +match[2] > 65535) fail('PRP_UPSTREAM_FIXED_IP_REQUIRED')
  if (!/^[a-zA-Z0-9.-]+$/.test(env.ZURI_PRP_UPSTREAM_TLS_NAME ?? '')) fail('PRP_UPSTREAM_IDENTITY_REQUIRED')
  if (!/^[a-zA-Z0-9_.-]+$/.test(env.ZURI_PRP_NETWORK ?? '')) fail('PRP_NETWORK_REQUIRED')
  try {
    const leaf = new X509Certificate(read(env.ZURI_PRP_TLS_CERT_FILE))
    const ca = new X509Certificate(read(env.ZURI_PRP_CLIENT_CA_FILE))
    const upstreamCA = new X509Certificate(read(env.ZURI_PRP_UPSTREAM_CA_FILE))
    if ([leaf, ca, upstreamCA].some(cert => createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('hex') === PUBLIC_TEST_SPKI)) {
      fail('PRP_TEST_CERTIFICATE_FORBIDDEN')
    }
    const privateKey = createPrivateKey(read(env.ZURI_PRP_TLS_KEY_FILE))
    const now = Date.now()
    if ([leaf, ca, upstreamCA].some(cert => Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now)
      || !ca.ca || !upstreamCA.ca || !leaf.checkIP(ip) || !leaf.verify(ca.publicKey)
      || !createPublicKey(privateKey).equals(leaf.publicKey)) fail('PRP_TLS_IDENTITY_INVALID')
  } catch (error) {
    if (error.message === 'PRP_TEST_CERTIFICATE_FORBIDDEN') throw error
    fail('PRP_TLS_IDENTITY_INVALID')
  }
  return { proxyIP: ip, upstreamIP: match[1], network: env.ZURI_PRP_NETWORK }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = checkConfig(process.env)
    if (process.argv.includes('--network')) {
      const [network] = JSON.parse(execFileSync('docker', ['network', 'inspect', config.network], { encoding: 'utf8', windowsHide: true }))
      if (!network.Internal || !Object.values(network.Containers ?? {}).some(container => container.IPv4Address?.split('/')[0] === config.upstreamIP)) fail('PRP_NETWORK_TARGET_NOT_ADMITTED')
    }
    process.stdout.write(`${JSON.stringify({ status: 'PASS', scope: 'configuration-only', networkChecked: process.argv.includes('--network') })}\n`)
  } catch {
    process.stderr.write('PRP_CONFIGURATION_REFUSED\n')
    process.exitCode = 1
  }
}
