// @req FR-084 — additive SQLite DDL preserves pre-column legacy rows.
import {it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
it('applies the issued SQLite migration without backfill or data loss',()=>{const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');try{db.exec(`CREATE TABLE Dependency(id TEXT PRIMARY KEY, sourceType TEXT,sourceId TEXT,targetType TEXT,targetId TEXT,dependencyType TEXT,createdAt TEXT); INSERT INTO Dependency VALUES('old','PROJECT','a','PROJECT','b','BLOCKS','2026-10-23T00:00:00.000Z')`);db.exec(readFileSync('prisma/migrations/20261024010000_dependency_handoff/migration.sql','utf8'));expect(db.prepare(`SELECT contractJson FROM Dependency WHERE id='old'`).get().contractJson).toBe(null);expect(db.prepare('PRAGMA table_info(Dependency)').all().find(c=>c.name==='contractJson').notnull).toBe(0)}finally{db.close()}})
