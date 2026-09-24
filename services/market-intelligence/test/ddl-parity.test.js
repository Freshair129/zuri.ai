import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { OBSERVATION_COLUMNS, POSTGRES_COLUMN_TYPES } from '../src/adapters/observation-schema.js'

// The service's view of "MarketObservation" must be the production table exactly:
// same columns, types and nullability as the Supabase migration that created it, and
// the same field set as the generated Prisma Postgres model the legacy writer uses.
// If either side adds or changes a column, this fails before the two writers disagree.

const repo = new URL('../../../', import.meta.url)
const migration = readFileSync(new URL('apps/server/supabase/migrations/20260820080000_market_observation.sql', repo), 'utf8')
const prisma = readFileSync(new URL('apps/server/prisma/schema.postgres.prisma', repo), 'utf8')

function migrationColumns() {
  const body = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS "MarketObservation" ('))
  const block = body.slice(body.indexOf('(') + 1, body.indexOf('CONSTRAINT'))
  return Object.fromEntries(block.split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.startsWith('"'))
    .map((line) => {
      const [, name, type] = line.match(/^"([^"]+)"\s+(.*)$/)
      return [name, type]
    }))
}

function prismaFields() {
  const model = prisma.slice(prisma.indexOf('model MarketObservation {'))
  return model.slice(0, model.indexOf('\n}'))
    .split('\n').slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('@@') && !line.startsWith('//'))
    .map((line) => line.split(/\s+/)[0])
}

test('columns, types and nullability match the production migration', () => {
  assert.deepEqual(migrationColumns(), Object.fromEntries(OBSERVATION_COLUMNS.map((c) => [c, POSTGRES_COLUMN_TYPES[c]])))
})

test('the column set matches the generated Prisma Postgres model', () => {
  assert.deepEqual([...prismaFields()].sort(), [...OBSERVATION_COLUMNS].sort())
})

test('lineageKey stays globally unique in production', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "MarketObservation_lineageKey_key" ON "MarketObservation"\("lineageKey"\)/)
})
