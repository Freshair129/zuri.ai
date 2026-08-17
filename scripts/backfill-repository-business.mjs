#!/usr/bin/env node
// @req FR-073 — give Repositories that predate the owning Business an owner.
// @spec SEC-008, BR-001
//
// `Repository.businessId` is nullable only because the column is additive over
// rows that already existed. A Repository with no Business is governed by
// nobody: every write to it is refused, for every principal. That is the correct
// fail-closed answer, and this script is how it stops being the *permanent*
// answer.
//
// The owner is derived from the Repository's Project links, and only where they
// agree. A Repository whose Projects sit in two different Businesses has no
// single owner to infer — assigning one would be inventing authority, which is
// the thing this whole effort refuses to do. Those are reported for a human to
// decide, not guessed.
//
//   node scripts/backfill-repository-business.mjs            # report only
//   node scripts/backfill-repository-business.mjs --apply    # write
//
// Read-only by default on purpose: a migration that runs before you have read
// what it intends to do is one you cannot review.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

/** Businesses owning the Projects this Repository is linked to, deduplicated. */
export function inferOwners(repository) {
  return [...new Set((repository.projects || []).map((link) => link.project?.businessId).filter(Boolean))]
}

/** Split repositories into the three outcomes, without touching the database. */
export function classify(repositories) {
  const resolvable = []
  const ambiguous = []
  const orphaned = []
  for (const repository of repositories) {
    const owners = inferOwners(repository)
    if (owners.length === 1) resolvable.push({ repository, businessId: owners[0] })
    else if (owners.length > 1) ambiguous.push({ repository, owners })
    else orphaned.push(repository)
  }
  return { resolvable, ambiguous, orphaned }
}

async function main() {
  const repositories = await prisma.repository.findMany({
    where: { businessId: null },
    select: {
      id: true,
      code: true,
      fullName: true,
      projects: { select: { project: { select: { businessId: true, code: true } } } },
    },
  })

  if (repositories.length === 0) {
    console.log('Every Repository already has an owning Business. Nothing to do.')
    return
  }

  const { resolvable, ambiguous, orphaned } = classify(repositories)
  console.log(`${repositories.length} Repositor${repositories.length === 1 ? 'y' : 'ies'} without an owning Business:\n`)

  for (const { repository, businessId } of resolvable) {
    console.log(`  RESOLVABLE  ${repository.code} → business ${businessId}`)
  }
  for (const { repository, owners } of ambiguous) {
    console.log(
      `  AMBIGUOUS   ${repository.code} — linked to Projects in ${owners.length} Businesses ` +
        `(${owners.join(', ')}). No single owner can be inferred; assign one deliberately.`,
    )
  }
  for (const repository of orphaned) {
    console.log(
      `  ORPHANED    ${repository.code} — no Project links, so nothing to infer from. ` +
        'Assign an owner or archive it.',
    )
  }

  if (!apply) {
    console.log(
      `\nRead-only. Re-run with --apply to write the ${resolvable.length} resolvable owner(s). ` +
        `${ambiguous.length + orphaned.length} would remain ownerless, and unwritable, either way.`,
    )
    return
  }

  for (const { repository, businessId } of resolvable) {
    await prisma.repository.update({ where: { id: repository.id }, data: { businessId } })
  }
  console.log(`\nApplied ${resolvable.length} owner(s).`)
  if (ambiguous.length + orphaned.length) {
    console.log(
      `${ambiguous.length + orphaned.length} Repositor${ambiguous.length + orphaned.length === 1 ? 'y' : 'ies'} ` +
        'still have no owner and remain refused for every principal. That is deliberate: ' +
        'the alternative is guessing at authority.',
    )
  }
}

// Importable for tests without running against a real database.
if (process.argv[1] && process.argv[1].endsWith('backfill-repository-business.mjs')) {
  main()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
