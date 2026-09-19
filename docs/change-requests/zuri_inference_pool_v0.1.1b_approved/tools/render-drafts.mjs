#!/usr/bin/env node
/** Bind reviewed IDs into a NEW staging directory; never write to the target repo. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const packetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = 'cfd5521e7d004e63ffead1e07f46045f1cdc06f2';
const usage = `Usage: node tools/render-drafts.mjs --map <approved-id-map.json> --output <NEW-directory> [--repo <zuri-worktree>]

Requires Node.js 22 or later. Uses only the standard library.
All numeric IDs must be reviewed by the integrator first. This tool cannot approve
or reserve IDs, inspect other active branches, or run repository governance.
--repo performs a read-only scan of the current checkout's ledger and tracked docs.
Output must not exist and must be outside both the packet and the target repository.
Never point this tool at production, a secret file, or an existing output directory.`;

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(usage); process.exit(0); }
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--map', '--output', '--repo'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--'))
      fail(`Invalid arguments.\n${usage}`);
    if (result[key.slice(2)]) fail(`Duplicate option: ${key}`);
    result[key.slice(2)] = argv[i + 1];
  }
  if (!result.map || !result.output) fail(usage);
  return result;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function filesUnder(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`Symbolic link not accepted in draft source: ${full}`);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}
function bind(text, idMap) {
  const rendered = text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, key) => {
    if (!Object.hasOwn(idMap, key)) fail(`Unknown ID slot: ${key}`);
    return idMap[key];
  });
  if (/\{\{|\}\}/.test(rendered)) fail('An unresolved or malformed ID placeholder remains.');
  return rendered;
}
function escapeRegex(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

try {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node.js 22 or later is required.');
  const args = parseArgs(process.argv.slice(2));
  const families = readJson(path.join(packetRoot, 'review', 'id-slot-families.json'));
  const idMap = readJson(path.resolve(args.map));
  if (!idMap || typeof idMap !== 'object' || Array.isArray(idMap)) fail('ID map must be a JSON object.');
  const expectedKeys = Object.keys(families).sort();
  if (JSON.stringify(Object.keys(idMap).sort()) !== JSON.stringify(expectedKeys)) fail('ID map must contain exactly the 13 documented slot keys.');
  for (const [key, family] of Object.entries(families)) {
    const value = idMap[key];
    if (typeof value !== 'string' || !new RegExp(`^${family}-[0-9]{3,}$`).test(value) || Number(value.split('-')[1]) === 0)
      fail(`Invalid/unbound ${key}; expected a reviewed ${family}-number, not null or a placeholder.`);
  }
  if (new Set(Object.values(idMap)).size !== expectedKeys.length) fail('Each ID slot must have a distinct identifier.');

  const requestedOutput = path.resolve(args.output);
  if (fs.existsSync(requestedOutput)) fail('Output already exists; refusing to overwrite it.');
  const realParent = fs.realpathSync(path.dirname(requestedOutput));
  const output = path.join(realParent, path.basename(requestedOutput));
  if (inside(output, fs.realpathSync(packetRoot))) fail('Output must be outside the documentation packet.');
  let collisionScan = { status: 'NOT_RUN', reason: 'No target repository supplied. Integrator must check published and active-lane IDs.' };
  if (args.repo) {
    const repo = fs.realpathSync(path.resolve(args.repo));
    if (inside(output, repo)) fail('Output must be outside the target repository.');
    const gitRoot = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
    if (fs.realpathSync(gitRoot) !== repo) fail('--repo must name the root of a Git worktree.');
    const ledgerPath = path.join(repo, 'docs', '.id-ledger.json');
    for (const relative of ['AGENTS.md', 'docs/.id-ledger.json', 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'])
      if (!fs.statSync(path.join(repo, relative)).isFile()) fail(`Missing Zuri input: ${relative}`);
    readJson(ledgerPath); // A malformed ledger is not an empty ledger.
    const listed = execFileSync('git', ['-C', repo, 'ls-files', '-z', '--', 'docs'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
    const paths = new Set([...listed.filter(p => /\.(?:md|json)$/.test(p)), 'docs/.id-ledger.json', 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md']);
    const collisions = [];
    for (const relative of paths) {
      const full = path.resolve(repo, relative);
      if (!inside(full, repo)) fail('Unsafe tracked path.');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail(`Symbolic link not accepted in collision scan: ${relative}`);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) fail(`Unreadable/oversized collision-scan input: ${relative}`);
      const text = `${relative}\n${fs.readFileSync(full, 'utf8')}`;
      for (const id of Object.values(idMap)) {
        if (new RegExp(`(?<![A-Z0-9_-])${escapeRegex(id)}(?![A-Z0-9_-])`).test(text)) collisions.push({ id, path: relative });
      }
    }
    if (collisions.length) fail(`IDs already occur in the supplied checkout. No files written.\n${JSON.stringify(collisions.slice(0,30), null, 2)}`);
    collisionScan = { status: 'PASS_CURRENT_CHECKOUT_ONLY', filesScanned: paths.size,
      checkoutCommit: execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      limitations: 'No remote write, ID reservation, other-branch inspection, subject review, or repository-governance execution.' };
  }

  const sources = filesUnder(path.join(packetRoot, 'drafts')).filter(p => p.endsWith('.md.template'));
  if (sources.length !== 12) fail('Expected exactly 12 approved design source documents.');
  const outputs = sources.map(file => ({
    relative: bind(path.relative(path.join(packetRoot, 'drafts'), file), idMap).replace(/\.template$/, ''),
    content: bind(fs.readFileSync(file, 'utf8'), idMap),
  }));
  outputs.push({ relative: path.join('handoff', 'registry-rows.json'),
    content: bind(fs.readFileSync(path.join(packetRoot, 'handoff', 'registry-rows.json.template'), 'utf8'), idMap) });
  JSON.parse(outputs.at(-1).content);
  const seen = new Set();
  for (const item of outputs) {
    const full = path.resolve(output, item.relative);
    if (!inside(full, output) || seen.has(full)) fail('Unsafe or duplicate output path.');
    seen.add(full);
  }
  // All input validation and collision checks complete before any output is created.
  fs.mkdirSync(output, { recursive: false });
  for (const item of outputs) {
    const destination = path.join(output, item.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.content, { encoding: 'utf8', flag: 'wx' });
  }
  const manifest = { packetVersion: '0.1.1b', baselineCommit: baseline, status: 'APPROVED_DESIGN_PENDING_REPOSITORY_INTEGRATION', idMap,
    collisionScan, approval: 'OWNER_CHAT_APPROVAL_RECORDED_2026_09_18', repositoryGovernance: 'NOT_RUN', runtimeTests: 'NOT_RUN',
    files: outputs.map(o => ({ path: o.relative.split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(o.content).digest('hex') })) };
  fs.writeFileSync(path.join(output, 'render-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(`Rendered 12 approved design documents and registry rows to ${output}.`);
  console.log(`Collision scan: ${collisionScan.status}. No target repository or ledger was modified.`);
} catch (error) {
  console.error(`Render refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
