// Resolves the GenesisBlock native engine.
//
// The engine used to be require()d from an absolute path on one machine
// (`G:/GenesisBlock_Dev/GenesisBlock/index.win32-x64-msvc.node`), which made a fresh checkout
// unable to ingest or serve. It is now a normal dependency
// (`@freshair129/gks-genesis-block-native`, https://github.com/Freshair129/GenesisBlock), so
// `npm install` is all that is required. `GENESIS_NATIVE_MODULE` still lets an operator point at
// a local build, and the legacy G: path is tried last so existing machines keep working.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const GENESIS_PACKAGE = '@freshair129/gks-genesis-block-native';
const LEGACY_PATHS = [
  'G:/GenesisBlock_Dev/GenesisBlock/index.win32-x64-msvc.node',
  'G:/GenesisBlock_Dev/GenesisBlock/index.js',
];

export interface GenesisOpenOptions {
  path: string;
  vectorDim?: number;
  retention?: string;
  readOnly?: boolean;
}

export interface GenesisDatabaseCtor {
  open(opts: GenesisOpenOptions): any;
}

export class GenesisBindingUnavailableError extends Error {
  constructor(readonly attempts: string[]) {
    super(
      `GENESIS_NATIVE_BINDING_UNAVAILABLE: could not load the GenesisBlock engine.\n` +
        `Tried:\n${attempts.map((a) => `  - ${a}`).join('\n')}\n` +
        `Fix: npm install ${GENESIS_PACKAGE}`,
    );
    this.name = 'GenesisBindingUnavailableError';
  }
}

let cached: GenesisDatabaseCtor | null = null;

/** Returns the GenesisDatabase constructor, or null if no binding could be loaded. */
export function tryLoadGenesisDatabase(): GenesisDatabaseCtor | null {
  if (cached) return cached;
  for (const candidate of candidates()) {
    try {
      const mod = candidate.startsWith('.') || path.isAbsolute(candidate)
        ? require(path.resolve(candidate))
        : require(candidate);
      if (mod?.GenesisDatabase) {
        cached = mod.GenesisDatabase as GenesisDatabaseCtor;
        return cached;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Same as `tryLoadGenesisDatabase`, but throws a message that says how to fix it. */
export function loadGenesisDatabase(): GenesisDatabaseCtor {
  const db = tryLoadGenesisDatabase();
  if (!db) throw new GenesisBindingUnavailableError(candidates());
  return db;
}

export function candidates(): string[] {
  const explicit = process.env.GENESIS_NATIVE_MODULE?.trim();
  return [
    ...(explicit ? [explicit] : []),
    GENESIS_PACKAGE,
    ...LEGACY_PATHS.filter((p) => fs.existsSync(p)),
  ];
}
