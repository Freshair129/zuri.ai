// @req FR-222 — where the harness credential and its config live: the user's
//   own configuration directory, outside any repository, never in a file the
//   plugin's git history could carry.
// @spec ADR-087 D3, D7
// @tested tests/unit/zuri-harness-plugin.test.js
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_REPOSITORIES = ['Freshair129/zuri.ai']

/** `$ZURI_HARNESS_HOME`, or `~/.zuri-harness` — never a path inside a repository. */
export function homeDir(env = process.env) {
  return env.ZURI_HARNESS_HOME || path.join(os.homedir(), '.zuri-harness')
}

function configPath(home) {
  return path.join(home, 'config.json')
}

/** Read the saved config, or null when this device has never paired. */
export function readConfig(home = homeDir()) {
  const file = configPath(home)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Save the config, creating the home directory if needed. Written 0o600 where
 * the platform supports file modes (a no-op, not an error, on platforms —
 * Windows included — that ignore it): the credential inside must never be
 * group- or world-readable by default.
 */
export function writeConfig(config, home = homeDir()) {
  mkdirSync(home, { recursive: true })
  const file = configPath(home)
  // `mode` on writeFileSync sets the permission bits at creation time; on a
  // filesystem that does not support POSIX bits (Windows/FAT/exFAT) it is
  // silently ignored rather than failing, which is the behaviour we want.
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  return file
}

/** Delete the saved config. Does not revoke the credential server-side — an
 * operator does that from the device list. */
export function clearConfig(home = homeDir()) {
  const file = configPath(home)
  if (existsSync(file)) rmSync(file, { force: true })
}
