// @req FR-223 — generated, never real, credential material for vault tests, and the
//   leak scan every vault suite runs over what it captured.
// @spec SEC-030 — a test secret must be found nowhere a secret may not be.
// @tested tests/integration/credential-vault-lifecycle.test.js

import { randomBytes, randomInt } from 'node:crypto'

/** A fresh LINE-shaped bundle. The values are random; none is a real credential. */
export function generateLineChannelBundle({ withToken = false } = {}) {
  const bundle = {
    channelId: String(randomInt(1_000_000_000, 2_000_000_000)),
    channelSecret: randomBytes(16).toString('hex'),
  }
  if (withToken) bundle.channelAccessToken = randomBytes(96).toString('base64url')
  return bundle
}

/** The strings a leak scan looks for: the secret, the token, and their base64 forms. */
export function secretNeedles(bundle) {
  const needles = [bundle.channelSecret]
  if (bundle.channelAccessToken) needles.push(bundle.channelAccessToken)
  for (const value of [...needles]) {
    needles.push(Buffer.from(value, 'utf8').toString('base64'))
    needles.push(Buffer.from(value, 'utf8').toString('base64url'))
  }
  return needles
}

/** Every needle found in any of the haystacks, with where it was found. */
export function findLeaks(haystacks, needles) {
  const leaks = []
  for (const [label, value] of Object.entries(haystacks)) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v))
    for (const needle of needles) if (text && text.includes(needle)) leaks.push(label)
  }
  return leaks
}

/** Capture console output for the duration of `work`. */
export async function captureConsole(work) {
  const lines = []
  const methods = ['log', 'info', 'warn', 'error', 'debug']
  const originals = Object.fromEntries(methods.map(m => [m, console[m]]))
  for (const method of methods) {
    console[method] = (...args) => { lines.push(args.map(a => (a instanceof Error ? `${a.name}:${a.message}:${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')) }
  }
  try {
    const result = await work()
    return { result, output: lines.join('\n') }
  } catch (error) {
    return { error, output: lines.join('\n') }
  } finally {
    for (const method of methods) console[method] = originals[method]
  }
}

/** Every serialisable trace of an error: message, code, stack, own and cause. */
export function errorTrace(error) {
  if (!error) return ''
  return JSON.stringify({
    name: error.name, message: error.message, code: error.code, status: error.status, stack: error.stack,
    own: Object.fromEntries(Object.getOwnPropertyNames(error).map(key => [key, String(error[key])])),
    cause: error.cause ? String(error.cause) : null,
  })
}
