import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_PATH = fileURLToPath(new URL('./contracts/controller.sql', import.meta.url));
const SCHEMA_VERSION = 'delivery-controller/v1';

export function assertSupportedRuntime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error('The delivery controller requires Node.js 22.13 or newer with node:sqlite, or Node.js 24+.');
  }
  if (typeof DatabaseSync !== 'function') throw new Error('This Node.js runtime does not provide node:sqlite DatabaseSync.');
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  }).trimEnd();
}

export function repositoryPaths(repoRoot) {
  const root = realpathSync.native(path.resolve(repoRoot));
  const top = realpathSync.native(git(root, ['rev-parse', '--show-toplevel']));
  const common = realpathSync.native(git(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  return { repoRoot: top, gitCommonDir: common };
}

export function resolvePrivateStorePath(repoRoot) {
  const { gitCommonDir } = repositoryPaths(repoRoot);
  return path.join(gitCommonDir, 'zuri-delivery-control', 'controller-v1.sqlite');
}

export function openControllerStore({ repoRoot, databasePath } = {}) {
  assertSupportedRuntime();
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new TypeError('repoRoot is required.');
  const paths = repositoryPaths(repoRoot);
  const filename = databasePath ? path.resolve(databasePath) : resolvePrivateStorePath(paths.repoRoot);
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  const runColumns = db.prepare('PRAGMA table_info(delivery_runs)').all().map((column) => column.name);
  if (!runColumns.includes('worktree_root')) db.exec("ALTER TABLE delivery_runs ADD COLUMN worktree_root TEXT NOT NULL DEFAULT ''");
  const version = db.prepare("SELECT value FROM controller_meta WHERE key = 'schemaVersion'").get()?.value;
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error('Unsupported delivery controller schema version: ' + String(version));
  }

  let inTransaction = false;
  return {
    db,
    ...paths,
    databasePath: filename,
    transaction(callback) {
      if (inTransaction) throw new Error('Nested controller transactions are not supported.');
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      try {
        const result = callback(db);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close() { db.close(); },
  };
}
