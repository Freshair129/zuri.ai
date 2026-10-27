import { expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import prisma from '../../../src/lib/db.js'

const outputDir = process.env.ZURI_FILE_DB_PROBE_OUTPUT

it('starts without the previous file’s table or rows', async () => {
  const previousFile = JSON.parse(readFileSync(path.join(outputDir, 'probe-a.json'), 'utf8'))
  expect(process.env.DATABASE_URL).not.toBe(previousFile.databaseUrl)

  const portfolioRows = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM Portfolio')
  expect(Number(portfolioRows[0].count)).toBe(0)
  const probeTables = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FileDatabaseIsolationProbe'",
  )
  expect(probeTables).toHaveLength(0)

  writeFileSync(
    path.join(outputDir, 'probe-b.json'),
    JSON.stringify({ databaseUrl: process.env.DATABASE_URL, initialProbeTableCount: probeTables.length, portfolioCount: Number(portfolioRows[0].count) }),
  )
})
