import { readFileSync } from 'node:fs'

/**
 * Every variable the MSP runtime reads, taken from MSP's own source
 * (Memory-and-Soul-Passport origin/main), plus the GKS variables MSP needs in
 * stdio mode when it spawns GKS. Nothing named ZURI_MSP_* is here: those
 * configure the Zuri transport and MSP never reads them.
 */
export const MSP_RUNTIME_ENV_NAMES = Object.freeze([
  'MSP_DB_PATH',
  'MSP_THREAD_SERVICE_KEY',
  'MSP_THREAD_SERVICE_KEYRING',
  'MSP_IDENTITY_HMAC_KEY',
  'MSP_GLOBAL_PRIVATE_GRANT_REQUIRED',
  'MSP_IDENTITY_HMAC_KEY_VERSION',
  'MSP_IDENTITY_HMAC_KEYRING',
  'MSP_THREAD_IDLE_TIMEOUT_MINUTES',
  'MSP_THREAD_RECENT_EXCHANGES',
  'MSP_THREAD_RETENTION_DAYS',
  'MSP_GKS_COMMAND',
  'MSP_GKS_ARGS',
  'MSP_GKS_CWD',
  'MSP_GKS_TRANSPORT',
  'MSP_GKS_HTTP_URL',
  'GKS_MSP_RELAY_CREDENTIAL',
  'MSP_PIPELINE_PRINCIPALS',
  'MSP_GKS_PIPELINE_CREDENTIAL',
  'MSP_PIPELINE_WORKER_URL',
  'MSP_PIPELINE_WORKER_TOKEN',
  'OLLAMA_BASE_URL',
  'GKS_DB_PATH',
  'GKS_PIPELINE_RELAY_CREDENTIAL',
  'GKS_DEFAULT_PORTFOLIO_ID',
  'GKS_AUTOMERGE_FLOOR',
])

const GKS_STDIO_ONLY_ENV_NAMES = new Set([
  'MSP_GKS_COMMAND',
  'MSP_GKS_ARGS',
  'MSP_GKS_CWD',
  'GKS_DB_PATH',
  'GKS_PIPELINE_RELAY_CREDENTIAL',
  'GKS_DEFAULT_PORTFOLIO_ID',
  'GKS_AUTOMERGE_FLOOR',
])

/**
 * OS values required for command lookup, temp/home paths, platform services,
 * and locale. No credentials, proxies, or NODE_OPTIONS are included.
 */
export const MSP_OS_ENV_NAMES = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ',
  'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'NODE_EXTRA_CA_CERTS',
])

const ALLOWED_ENV_NAMES = new Set([...MSP_RUNTIME_ENV_NAMES, ...MSP_OS_ENV_NAMES].map((name) => name.toUpperCase()))

const HTTP_SECRET_FILES = Object.freeze([
  ['GKS_MSP_RELAY_CREDENTIAL_FILE', 'GKS_MSP_RELAY_CREDENTIAL'],
  ['MSP_GKS_PIPELINE_CREDENTIAL_FILE', 'MSP_GKS_PIPELINE_CREDENTIAL'],
])

function readHttpSecret(env, fileVariable, childVariable, child) {
  const file = typeof env?.[fileVariable] === 'string' ? env[fileVariable].trim() : ''
  if (!file) return
  let value
  try {
    value = readFileSync(file, 'utf8').trim()
  } catch {
    throw new Error(`${fileVariable} could not be read`)
  }
  if (!value) throw new Error(`${fileVariable} is empty`)
  child[childVariable] = value
}

/** Return only the allowlisted variables MSP consumes, never its parent's full environment. */
export function buildMspChildEnvironment(env = process.env) {
  const child = {}
  const gksTransport = typeof env?.MSP_GKS_TRANSPORT === 'string'
    ? env.MSP_GKS_TRANSPORT.trim().toLowerCase()
    : 'stdio'
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string' || !ALLOWED_ENV_NAMES.has(name.toUpperCase())) continue
    if (gksTransport === 'http' && GKS_STDIO_ONLY_ENV_NAMES.has(name.toUpperCase())) continue
    child[name] = value
  }
  if (gksTransport === 'http') {
    for (const [fileVariable, childVariable] of HTTP_SECRET_FILES) {
      readHttpSecret(env, fileVariable, childVariable, child)
    }
  }
  return child
}
