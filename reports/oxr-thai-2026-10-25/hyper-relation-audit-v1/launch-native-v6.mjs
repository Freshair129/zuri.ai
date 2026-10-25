// Disposable acceptance container entrypoint. The baseline gold manifest must survive the harness overlay.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(POSTGRES_|DATABASE_POSTGRES_URL$|DATABASE_URL$|MSP_DB_PATH$|GKS_DB_PATH$|GENESIS_DB_PATH$|ZURI_MSP_|MSP_GKS_|MSP_PIPELINE_|GKS_PIPELINE_)/.test(key)) delete env[key];
}
for (const key of ['KI17_MSP_ROOT', 'KI17_GKS_ROOT', 'KI17_GENESIS_ROOT', 'KI17_MODEL_DIR']) {
  if (!env[key] || !fs.existsSync(env[key])) throw new Error(`Missing isolated runtime ${key}`);
}

fs.cpSync('/previous', '/app/experiment', { recursive: true, errorOnExist: true, force: false });
fs.cpSync('/harness', '/app/experiment', { recursive: true, force: true });
// Hyper v1's harness folder contains its own evidence manifest. Restore the
// original sealed baseline manifest so gold.json is checked against its owner.
fs.copyFileSync('/previous/evidence-manifest.json', '/app/experiment/evidence-manifest.json');

const files = [
  '/opt/ki17/pins/resolved.json',
  '/opt/ki17/genesisblock/genesisrag17-worker/src/worker.mjs',
  '/opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py',
  '/app/prisma/schema.prisma',
  '/app/src/platform/integrations/core/genesisrag17-executor.js',
  '/app/tests/fixtures/genesisrag17-corpus-v1.json',
  '/app/experiment/native.test.js',
  '/app/experiment/native.config.mjs',
  '/app/experiment/evidence-manifest.json',
  '/launch/launch-native-v6.mjs',
];
const hashes = Object.fromEntries(files.map((file) => [
  file,
  createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
]));
const goldPath = '/app/experiment/gold.json';
const baselineManifest = JSON.parse(fs.readFileSync('/app/experiment/evidence-manifest.json', 'utf8'));
const goldSha256 = createHash('sha256').update(fs.readFileSync(goldPath)).digest('hex');
const expectedGoldSha256 = baselineManifest.frozen?.goldSha256?.toLowerCase();
if (!expectedGoldSha256 || goldSha256.toLowerCase() !== expectedGoldSha256) {
  throw new Error('Copied gold.json does not match the sealed real-native evidence manifest');
}
hashes[goldPath] = goldSha256;
fs.writeFileSync('/bench/runtime-provenance.json', JSON.stringify({
  node: process.version,
  hashes,
  pins: JSON.parse(fs.readFileSync('/opt/ki17/pins/resolved.json', 'utf8')),
  gold: { path: goldPath, sha256: goldSha256, expectedFrozenSha256: expectedGoldSha256 },
  manifestSource: '/previous/evidence-manifest.json',
}, null, 2), { flag: 'wx' });

const result = spawnSync(process.execPath, [
  'scripts/assert-tests-ran.mjs', 'vitest', 'run', '--config', 'experiment/native.config.mjs',
], { cwd: '/app', env, stdio: 'inherit' });
process.exit(result.status ?? 1);
