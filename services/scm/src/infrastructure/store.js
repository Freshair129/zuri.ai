import { openSqliteStore } from './sqlite-store.js'
import { openPostgresStore } from './pg-store.js'

// The one place an engine is chosen. Both stores expose the same port.
export function openStore({ store = 'sqlite', sqlitePath, pgUrl, ensureSchema = false }) {
  if (store === 'postgres') return openPostgresStore({ url: pgUrl, ensureSchema })
  return openSqliteStore({ location: sqlitePath, ensureSchema })
}
