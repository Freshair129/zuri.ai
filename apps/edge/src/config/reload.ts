import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { loadConfig, type AgentConfig } from './index.js';

/** What `loadConfig` actually returns: every field optional. */
type LoadedConfig = Partial<AgentConfig>;

/**
 * Re-reading configuration after the local settings page has written it.
 *
 * A value is hot-reloadable here only because the local conversation layer reads it per request;
 * filesystem roots and retention settings remain restart-only because they configure owned state.
 */

/** Read per request or rebuilt per call, so assigning a new value is enough. */
export const HOT_RELOADABLE = [
  'lineHistoryAllowedGroupAliases',
  'llmEnabled',
  'llmModel',
  'headlessEnabled',
  'headlessModel',
] as const;

/** Captured at startup by something that holds state. Changing these needs the process restarted. */
export const REQUIRES_RESTART = [
  'lineHistoryRoot',
  'lineHistoryHashKey',
  'lineHistoryRetentionDays',
  'outboxRoot',
] as const;

type Field = (typeof HOT_RELOADABLE)[number] | (typeof REQUIRES_RESTART)[number];

/**
 * Load configuration from `.env` as it is on disk right now.
 *
 * `dotenv.config()` will not do: it does not overwrite variables already present in `process.env`,
 * so after the first load it can only ever return what the process started with — exactly the
 * staleness this is here to fix. Parsing the file and layering it over the environment gives the
 * file the last word, which is what the operator just used.
 */
export function readConfigFromDisk(
  envPath = path.resolve('.env'),
  /**
   * What the file is layered over. Injectable so a test can start from nothing: with the real
   * `process.env` underneath, a `*_FILE` variable the process happens to carry silently outranks
   * the value in the file being read, and the test measures the machine instead of the code.
   */
  baseEnv: NodeJS.ProcessEnv = process.env,
): LoadedConfig {
  const parsed = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
  return loadConfig({ ...baseEnv, ...parsed });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Which settings actually changed, split by whether this process can pick them up. */
export function diffConfig(
  before: LoadedConfig,
  after: LoadedConfig,
): { reloaded: Field[]; requiresRestart: Field[] } {
  const changed = (field: Field): boolean =>
    !sameValue((before as unknown as Record<string, unknown>)[field], (after as unknown as Record<string, unknown>)[field]);
  return {
    reloaded: HOT_RELOADABLE.filter(changed),
    requiresRestart: REQUIRES_RESTART.filter(changed),
  };
}

/**
 * Bring a running process up to date with what is on disk.
 *
 * `current` is mutated in place rather than replaced because callers may already hold that object.
 */
export function applySavedConfig(
  current: LoadedConfig,
  next: LoadedConfig = readConfigFromDisk(),
): { reloaded: string[]; requiresRestart: string[] } {
  const { reloaded, requiresRestart } = diffConfig(current, next);

  Object.assign(current, next);

  return { reloaded: [...reloaded], requiresRestart: [...requiresRestart] };
}

/**
 * Write one key into `.env`, replacing it if present.
 *
 * Quoted on the way out so values containing `#` remain intact when parsed by `dotenv`.
 */
export function upsertEnvValue(key: string, value: string, envPath = path.resolve('.env')): void {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const updated = pattern.test(existing) ? existing.replace(pattern, line) : `${existing.trimEnd()}\n${line}`;
  fs.writeFileSync(envPath, `${updated.trim()}\n`, 'utf8');
}
