import { execSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import path from 'path'

// Create a fresh isolated SQLite test database before the test run.
export default function globalSetup() {
  const testDb = path.resolve(__dirname, '..', 'prisma', 'test.db')
  if (existsSync(testDb)) rmSync(testDb)
  execSync('npx prisma db push --skip-generate', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  })
}
