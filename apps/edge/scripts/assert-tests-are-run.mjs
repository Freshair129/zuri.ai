#!/usr/bin/env node
/**
 * Fail if any test file on disk is not actually run by the `test` script.
 *
 * A test file nobody runs makes the suite green while covering less, and silence
 * looks exactly like success — the one thing CI must not allow. This repository has
 * already had it happen: `npm test` named its files by hand, a new suite of nine
 * tests was added, and the run reported success having executed none of them.
 *
 * The question asked here is the real one — does the pattern handed to `node --test`
 * cover every test file? — rather than the proxy the first version of this check
 * used, which was whether the script mentioned each filename literally. That proxy
 * failed the build the moment the script was fixed to use a glob, which is the wrong
 * way round for a guard.
 *
 * So a hand-written list is still checked file by file, and a glob is checked by
 * matching. Narrowing the glob to `tests/unit/**` or dropping a file from a list both
 * fail here, which is the whole point.
 *
 * Lives in a file rather than inline in the workflow so it can be run locally and so
 * its escaping is not a three-layer YAML/shell/JS puzzle.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const TEST_ROOT = 'tests';
const SUFFIX = '.test.ts';

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const posix = (file) => file.split(path.sep).join('/');

const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts?.test;
if (!script) {
  console.error('package.json has no "test" script.');
  process.exit(1);
}

/** Everything after `--test`, stripped of the quoting the shell would have removed. */
const patterns = script
  .split('--test')
  .slice(1)
  .join(' ')
  .split(/\s+/)
  .map((token) => token.replace(/^["'\\]+|["'\\]+$/g, ''))
  .filter(Boolean);

if (patterns.length === 0) {
  console.error('The "test" script passes nothing to `node --test`.');
  process.exit(1);
}

const found = walk(TEST_ROOT).filter((file) => file.endsWith(SUFFIX)).map(posix);

if (found.length === 0) {
  // An empty run is not a passing run. Without this the check would report success
  // on a repository whose tests had all been deleted.
  console.error(`No ${SUFFIX} files under ${TEST_ROOT}/ — this check is proving nothing.`);
  process.exit(1);
}

const covered = (file) =>
  patterns.some((pattern) => pattern === file || path.matchesGlob(file, pattern));

const orphans = found.filter((file) => !covered(file));
if (orphans.length > 0) {
  console.error('Test files the "test" script does not run:');
  for (const file of orphans) console.error(`  ${file}`);
  console.error('Widen the pattern, or the suite is green while never running them.');
  process.exit(1);
}

console.log(`all ${found.length} test file(s) are run by: ${patterns.join(' ')}`);
