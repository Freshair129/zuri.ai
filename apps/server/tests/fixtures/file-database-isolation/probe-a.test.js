import { expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import prisma from '../../../src/lib/db.js'

const outputDir = process.env.ZURI_FILE_DB_PROBE_OUTPUT
const databaseUrl = process.env.DATABASE_URL
let portfolioCount

it('starts from the empty schema and writes a file-local marker', async () => {
  const portfolioRows = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM Portfolio')
  portfolioCount = Number(portfolioRows[0].count)
  expect(portfolioCount).toBe(0)

  const before = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'FileDatabaseIsolationProbe'",
  )
  expect(before).toHaveLength(0)

  await prisma.$executeRawUnsafe('CREATE TABLE FileDatabaseIsolationProbe(value TEXT NOT NULL)')
  await prisma.$executeRawUnsafe("INSERT INTO FileDatabaseIsolationProbe(value) VALUES ('from-probe-a')")
})

it('retains the marker across tests in this file', async () => {
  const withinFile = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM FileDatabaseIsolationProbe')
  expect(Number(withinFile[0].count)).toBe(1)

  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    path.join(outputDir, 'probe-a.json'),
    JSON.stringify({ databaseUrl, withinFileCount: Number(withinFile[0].count), portfolioCount }),
  )
})
