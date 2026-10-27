// @req FR-107 — reuse the existing CLI/service under one locked transaction.
// @spec ADR-115 — this fixed command is shipped by the host, not supplied by a manifest.
// @tested tests/node/compact-bootstrap.test.mjs, tests/e2e/compact-core.spec.js
export const COMPACT_BOOTSTRAP_COMMAND = String.raw`
import { readFileSync } from 'node:fs';
import { main } from '/app/scripts/bootstrap-operator.mjs';
import prisma from '/app/src/lib/db.js';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  let result;
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20000ms'");
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(115107::bigint)::text');
    const control = await tx.$queryRawUnsafe('SELECT system_identifier::text AS id FROM pg_control_system()');
    const database = await tx.$queryRawUnsafe('SELECT oid::int AS id FROM pg_database WHERE datname=current_database()');
    const marker = await tx.$queryRawUnsafe('SELECT payload FROM zuri_compact.installation WHERE singleton=true');
    if (control[0]?.id !== input.expected.systemIdentifier || database[0]?.id !== input.expected.databaseOid || marker[0]?.payload?.targetId !== input.expected.targetId || marker[0]?.payload?.manifestSha256 !== input.expected.manifestSha256) {
      const error = new Error('COMPACT_BOOTSTRAP_REFUSED'); error.status = 409; throw error;
    }
    const adapter = new Proxy(tx, { get(target, key) {
      if (key === '$transaction') return operation => operation(tx);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await main(['--email', input.operator.email, '--name', input.operator.displayName], {
      db: adapter, log: text => { if (result) throw new Error('COMPACT_BOOTSTRAP_FAILED'); result = JSON.parse(text); }
    });
  }, { maxWait: 5000, timeout: 25000 });
  if (!result?.initialPassword) throw new Error('COMPACT_BOOTSTRAP_FAILED');
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  const refused = error?.status === 409;
  process.stderr.write(refused ? 'COMPACT_BOOTSTRAP_REFUSED\n' : 'COMPACT_BOOTSTRAP_FAILED\n');
  process.exitCode = refused ? 2 : 3;
} finally { await prisma.$disconnect(); }
`
