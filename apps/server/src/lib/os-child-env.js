/**
 * The environment for a child process that needs nothing from this application.
 *
 * An allow-list, not a deny-list: this server's environment holds database
 * URLs, LINE credentials and model API keys, and a deny-list only withholds
 * what someone remembered to name — the one nobody remembered is the one that
 * leaks. A helper that launches a file browser or queries a local CLI has no
 * use for any of it.
 *
 * The same reasoning, and the same OS set, as the MSP child environment in
 * `src/modules/agent/msp-stdio-transport.js` and the CLI child environment in
 * `apps/edge/src/answer/headless.ts`. NODE_OPTIONS is excluded deliberately: it
 * can load arbitrary code into the child.
 */
export const OS_CHILD_ENV_NAMES = Object.freeze([
  'PATH', 'PATHEXT', 'COMSPEC',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR',
  'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES',
  'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'TZ',
])

const ALLOWED = new Set(OS_CHILD_ENV_NAMES)

/**
 * Windows spells these `Path` and `SystemRoot`, and its environment is
 * case-insensitive, so names are matched without case and copied as spelled.
 */
export function buildOsChildEnv(env = process.env) {
  const child = {}
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string' && ALLOWED.has(name.toUpperCase())) child[name] = value
  }
  return child
}
