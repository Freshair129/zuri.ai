// @req FR-294 — same HTTP/DB lifecycle on a fresh embedded PostgreSQL, never a shared URL.
import base from './vitest.config'
export default {...base,test:{...base.test,include:['tests/integration/office-design-registration.test.js','tests/postgres/office-design-migration.test.js',...(process.env.OFFICE_HTTP_STANDALONE==='1'?['tests/integration/office-design-next-http.test.js']:[])],globalSetup:['tests/global-setup-postgres.js'],hookTimeout:120000}}
