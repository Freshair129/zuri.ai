import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// @req FR-087, FR-088, FR-089 — project priority, the accountable Person (PIC), and
// Team / TeamMembership / ProjectTeam as an organisational grouping.
// @spec BR-018, ADR-036, ADR-037 — a Team groups people and grants nothing.
// @tested tests/unit/projects-dashboard-schema-migration.test.js

const MIGRATION_PATH =
  'supabase/migrations/20260819161900_projects_dashboard_team_and_project_priority.sql'
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8')
const labInit = fs.readFileSync('prisma/postgres/0001_init.sql', 'utf8')

const squash = (sql) => sql.replace(/\s+/g, ' ').trim()

/** Statements with comments and blank lines removed, one per entry. */
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map(squash)
  .filter(Boolean)

describe('FR-087/088/089 projects dashboard schema migration', () => {
  it('is additive only — it can never destroy production data', () => {
    // The change was applied to a live database. A DROP or a DELETE here would mean the
    // recorded history claims something the additive push provably did not do.
    expect(migration).not.toMatch(/\b(drop|truncate|delete\s+from|alter\s+column)\b/i)

    // Both new Project columns must stay nullable: existing rows predate them.
    expect(migration).toMatch(/ADD COLUMN "priority" TEXT;/)
    expect(migration).toMatch(/ADD COLUMN "picPersonId" TEXT;/)
    expect(migration).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i)
  })

  it('creates the three grouping tables with their identity constraints', () => {
    for (const table of ['Team', 'TeamMembership', 'ProjectTeam']) {
      expect(squash(migration)).toContain(`CREATE TABLE "${table}" (`)
      expect(migration).toContain(`CONSTRAINT "${table}_pkey" PRIMARY KEY ("id")`)
    }

    // A person joins a team once; a team joins a project once. Without these the join
    // tables would silently accept duplicates and every count would over-report.
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "TeamMembership_teamId_personId_key" ON "TeamMembership"\("teamId", "personId"\)/,
    )
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "ProjectTeam_projectId_teamId_key" ON "ProjectTeam"\("projectId", "teamId"\)/,
    )
  })

  it('grants nothing — BR-018, a Team is not an authority', () => {
    // The whole point of ADR-037: this migration must not touch any table or object that
    // answers "what may this principal do", and must not hand out database privilege.
    expect(migration).not.toMatch(/\b(GRANT|REVOKE|CREATE ROLE|SECURITY DEFINER)\b/i)
    expect(migration).not.toMatch(/"(Membership|RoleBinding|ExternalIdentity)"/)
  })

  it('keeps the referential actions that were actually applied to production', () => {
    // A PIC leaving must not delete the project; a Business must not be left with an
    // orphaned Team. These differ per relation and were verified against the live schema.
    expect(migration).toMatch(
      /"Project_picPersonId_fkey" FOREIGN KEY \("picPersonId"\) REFERENCES "Person"\("id"\) ON DELETE SET NULL/,
    )
    expect(migration).toMatch(
      /"Team_businessId_fkey" FOREIGN KEY \("businessId"\) REFERENCES "Business"\("id"\) ON DELETE RESTRICT/,
    )
    for (const fk of ['TeamMembership_teamId', 'TeamMembership_personId', 'ProjectTeam_projectId', 'ProjectTeam_teamId']) {
      expect(migration).toMatch(new RegExp(`"${fk}_fkey"[^;]*ON DELETE CASCADE`))
    }
  })

  it('does not drift from the generated lab schema', () => {
    // Two lineages describe the same objects: this file (production history) and the
    // regenerated prisma/postgres/0001_init.sql (rebuild-from-empty). If a later schema
    // change reaches only one of them, they disagree and this fails.
    const squashedInit = squash(labInit)
    const crossChecked = statements.filter((s) => /^(CREATE (UNIQUE )?INDEX|ALTER TABLE "\w+" ADD CONSTRAINT)/.test(s))

    expect(crossChecked.length).toBeGreaterThanOrEqual(15)
    for (const statement of crossChecked) {
      expect(squashedInit, `absent from 0001_init.sql: ${statement}`).toContain(statement)
    }

    // The two Project columns live inside CREATE TABLE "Project" there, not in an ALTER.
    const projectTable = labInit.match(/CREATE TABLE "Project" \([\s\S]*?\n\);/)?.[0] ?? ''
    expect(projectTable).toMatch(/"priority" TEXT,/)
    expect(projectTable).toMatch(/"picPersonId" TEXT,/)
  })
})
