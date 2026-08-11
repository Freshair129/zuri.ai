// Point the Prisma client at the isolated test database.
// Runs before any test-file import, so src/lib/db.js picks this up.
process.env.DATABASE_URL = 'file:./test.db'
