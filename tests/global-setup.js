import { execSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import path from 'path'

// Create a fresh isolated SQLite test database before the test run.
export default function globalSetup() {
  const testDb = path.resolve(__dirname, '..', 'prisma', 'test.db')
  if (existsSync(testDb)) rmSync(testDb)
  const inheritedRustLog = String(process.env.RUST_LOG || '').toLowerCase()
  const prismaRustLog = /(?:trace|debug|info)/.test(inheritedRustLog)
    ? process.env.RUST_LOG
    : 'info'
  execSync('npx prisma db push --skip-generate', {
    cwd: path.resolve(__dirname, '..'),
    // Prisma 5.22's Windows schema engine can terminate during silent startup
    // under the repository's Node 24 toolchain. Keep a deterministic log mode
    // for the child process while allowing CI/debug callers to override it.
    env: {
      ...process.env,
      DATABASE_URL: 'file:./test.db',
      RUST_LOG: prismaRustLog,
    },
    stdio: 'inherit',
  })
}
