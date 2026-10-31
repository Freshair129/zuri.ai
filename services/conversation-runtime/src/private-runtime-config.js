// @req FR-267 — independent Runtime enforces the same HTTPS/loopback boundary as Core.
// @spec ADR-099 D10, ADR-100 D7, ADR-106 D5
// @tested services/conversation-runtime/test/model-port.test.js
// Kept dependency-free inside this independently built service. Server's parity
// regression checks this policy against its configuration reader.
export function normalizePrivateRuntimeBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let url
  try { url = new URL(raw.trim()) } catch { return null }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null
  if (url.username || url.password || url.search || url.hash) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'metadata.google.internal' || host === 'metadata' || host === 'instance-data'
    || host === '100.100.100.200' || /^(?:0|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(host)
    || /^\[(?:::|::ffff:.*|fe[89ab][0-9a-f]:.*|ff[0-9a-f:]+|fd00:ec2::254)\]$/.test(host)) return null
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}
