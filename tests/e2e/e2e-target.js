const { createHash } = require('node:crypto')
const { statSync } = require('node:fs')
const path = require('node:path')

// @req FR-046 — browser entry tests own an isolated, seeded SQLite authority.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/playwright-database-bootstrap.test.js
//
// **One place decides where the e2e run lives.**
//
// The port and the database used to be two hard-coded literals in two files —
// `3100` in `playwright.config.js` and `file:./e2e.db` in `global-setup.js`. They
// had to agree, and nothing made them agree; a mismatch is exactly the defect
// recorded in .brain/rca/2026-08-14-e2e-database-bootstrap-gap.md, where the
// suite seeded one database and the server read another.
//
// Being literals also made the suite a singleton: a second checkout of this
// repository could not run e2e at all, because the port was already bound and
// the two runs would have shared one `e2e.db` even if it were free. Deriving both
// from a single resolved target fixes the collision and the mismatch with the
// same change — the port and the database now cannot disagree, because there is
// only one decision.
//
// **The primary checkout keeps :3100 exactly.** A git worktree stores `.git` as a
// *file* pointing at the real repository, while a normal checkout has it as a
// *directory*. CI always runs a normal checkout, so CI, the docs and every
// habit built around `localhost:3100` are unchanged; only additional worktrees
// move, and they move deterministically rather than by probing, so two trees
// never race for the same port and a rerun in one tree always lands on the port
// and database it used last time.

const ROOT = path.resolve(__dirname, '..', '..')
const BASE_PORT = 3100
/** Ports BASE_PORT+1 … BASE_PORT+SPREAD are available to worktrees. */
const SPREAD = 60

function isPrimaryCheckout(root = ROOT) {
  try {
    // A worktree's `.git` is a file ("gitdir: …"); a primary checkout's is a dir.
    return statSync(path.join(root, '.git')).isDirectory()
  } catch {
    // No `.git` at all (a tarball, a container copy). Treat it as primary: there
    // is no sibling worktree to collide with.
    return true
  }
}

/**
 * Which port this checkout runs its e2e server on.
 *
 * `E2E_PORT` wins when set, so a human or a CI job can pin it explicitly.
 */
function resolveE2ePort({ root = ROOT, env = process.env, primary } = {}) {
  const explicit = Number(env.E2E_PORT)
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  // `primary` is an injection seam: detection reads the filesystem, and the
  // no-`.git` fallback below reports "primary", so a test naming a path that does
  // not exist could otherwise only ever exercise the primary branch.
  if (primary === undefined ? isPrimaryCheckout(root) : primary) return BASE_PORT
  // Deterministic in the worktree's own path: stable across reruns, distinct
  // between trees, and decided without binding anything.
  const digest = createHash('sha256').update(path.resolve(root)).digest()
  return BASE_PORT + 1 + (digest.readUInt16BE(0) % SPREAD)
}

/**
 * Everything about this run's target, derived from the one port decision.
 *
 * The database name carries the port so the pairing is visible on disk: if a
 * server is up on 3142, its data is in `prisma/e2e-3142.db`, and there is no way
 * to be looking at the wrong one.
 */
function e2eTarget(options = {}) {
  const port = resolveE2ePort(options)
  const root = options.root || ROOT
  const databaseFile = `e2e-${port}.db`
  return {
    port,
    baseURL: `http://localhost:${port}`,
    // Relative, because Prisma resolves a `file:` datasource against the schema
    // directory — the same reason tests/global-setup.js keeps its URL relative.
    databaseUrl: `file:./${databaseFile}`,
    databaseFile,
    databasePath: path.resolve(root, 'prisma', databaseFile),
    isPrimaryCheckout: options.primary === undefined ? isPrimaryCheckout(root) : options.primary,
  }
}

module.exports = { e2eTarget, resolveE2ePort, isPrimaryCheckout, BASE_PORT, SPREAD }
