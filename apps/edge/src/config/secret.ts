import fs from 'fs';

// @req SEC-005 — a credential may be read from an OS-restricted file instead of the environment.
// @req SDD-007 — the `${NAME}_FILE` adapter named in the config design.

/**
 * Resolve a secret from the environment, honoring the Docker-secrets `_FILE` convention: when
 * `${name}_FILE` is set, its content is read from disk and used instead of `${name}` itself.
 *
 * This is the gap SEC-005 named: device credentials, the LINE channel secret, and the archive's
 * HMAC key all lived only as plaintext values in `.env`. The `_FILE` suffix is the same pattern
 * the official Postgres/MySQL Docker images use — a secret mounted read-only by the orchestrator,
 * or a file protected by OS ACLs, never a value the process environment or a dumped `.env` file
 * carries directly. A deployment that has always set `${name}` in plain `.env` keeps working
 * unchanged; the file form is additive, not a migration anyone is forced into.
 */
export function resolveSecret(env: NodeJS.ProcessEnv, name: string): string {
  const fileVar = `${name}_FILE`;
  const filePath = env[fileVar];
  if (!filePath) return env[name] || '';
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    throw new Error(`${fileVar} names a secret file that could not be read: ${filePath}`);
  }
}
