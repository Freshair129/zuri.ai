// @req FR-294 — actual additive SQL, constraints and source/provider parity.
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {describe,it,expect,inject} from 'vitest'
import pg from 'pg'
const sql=readFileSync(new URL('../../supabase/migrations/20261031120000_office_design_registry.sql',import.meta.url),'utf8')
describe('Office PostgreSQL additive migration',()=>{
 it('applies to an isolated namespace with existing parents and enforces scoped uniqueness/FKs',async()=>{
  expect(inject('testDatabaseEngine')).toBe('postgresql')
  expect(sql).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE)\b/im)
  const client=new pg.Client({connectionString:inject('testDatabaseUrl')}),schema='office_mig_'+randomUUID().replaceAll('-','')
  if(!/^office_mig_[a-f0-9]{32}$/.test(schema))throw Error('Unsafe owned test schema')
  await client.connect()
  try{
   await client.query(`CREATE SCHEMA "${schema}"`)
   await client.query(`SET search_path TO "${schema}"`)
   for(const name of ['Tenant','Business','Workspace'])await client.query(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY)`)
   await client.query(sql)
   const tables=await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1',[schema])
   expect(tables.rows.filter(r=>r.table_name.startsWith('OfficeDesign'))).toHaveLength(5)
   for(const [name,id]of [['Tenant','t'],['Business','b'],['Workspace','w']])await client.query(`INSERT INTO "${name}" (id) VALUES ($1)`,[id])
   await client.query('INSERT INTO "OfficeDesignRegistry" (id,code,"tenantId","businessId","workspaceId",source,"packageId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',['r','ODR-r','t','b','w','visual-office-design','p'])
   await expect(client.query('DELETE FROM "Workspace" WHERE id=$1',['w'])).rejects.toMatchObject({code:'23503'})
   await expect(client.query('INSERT INTO "OfficeDesignRegistry" (id,code,"tenantId","businessId","workspaceId",source,"packageId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',['r2','ODR-r2','t','b','w','visual-office-design','p'])).rejects.toMatchObject({code:'23505'})
   const byte=Buffer.from([0,1,2,255]);await client.query('INSERT INTO "OfficeDesignBlob" (id,"registryId",sha256,"byteLength",bytes) VALUES ($1,$2,$3,$4,$5)',['blob','r','test-hash',byte.length,byte])
   expect((await client.query('SELECT bytes FROM "OfficeDesignBlob" WHERE id=$1',['blob'])).rows[0].bytes).toEqual(byte)
  }finally{await client.query('RESET search_path');await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await client.end()}
 })
})
