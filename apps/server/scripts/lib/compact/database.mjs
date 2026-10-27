// @spec ADR-115 — read-only catalog identity and one atomic fresh initialization.
// @tested tests/postgres/compact-fresh-install.test.js
import { digest, stableJson } from './files.mjs'
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const USER_NAMESPACE = `n.nspname NOT IN ('pg_catalog','pg_toast','information_schema') AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$'`
export const COMPACT_OBJECT_COUNT = `((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_NAMESPACE}) + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${USER_NAMESPACE}) + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE ${USER_NAMESPACE} AND t.typrelid=0 AND t.typelem=0 AND t.typtype IN ('e','d','r','m')) + (SELECT count(*) FROM pg_namespace n WHERE ${USER_NAMESPACE} AND n.nspname<>'public') + (SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql') + (SELECT count(*) FROM pg_largeobject_metadata))`
const CATALOG = `jsonb_build_object(
 'relations',COALESCE((SELECT jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${USER_NAMESPACE} AND n.nspname<>'zuri_compact'),'[]'::jsonb),
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_array(c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
 'constraints',COALESCE((SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid,true)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),'[]'::jsonb),
 'policies',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE p.schemaname='public'),'[]'::jsonb),
 'grants',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.table_name,g.grantee,g.privilege_type) FROM information_schema.table_privileges g WHERE g.table_schema='public'),'[]'::jsonb),
 'indexes',COALESCE((SELECT jsonb_agg(jsonb_build_array(t.relname,i.relname,pg_get_indexdef(i.oid)) ORDER BY t.relname,i.relname) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'),'[]'::jsonb),
 'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),'[]'::jsonb),
 'namespaces',COALESCE((SELECT jsonb_agg(jsonb_build_array(n.nspname,n.nspowner,n.nspacl) ORDER BY n.nspname) FROM pg_namespace n WHERE ${USER_NAMESPACE} AND n.nspname<>'zuri_compact'),'[]'::jsonb),
 'defaults',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d),'[]'::jsonb),
 'database',(SELECT jsonb_build_array(datname,datdba,datacl,datallowconn,datconnlimit) FROM pg_database WHERE datname=current_database()),
 'sequences',COALESCE((SELECT jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'),'[]'::jsonb),
 'functions',COALESCE((SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prokind,p.proowner,p.proacl,p.prosecdef,p.proconfig,p.prosrc) ORDER BY n.nspname,p.proname,p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${USER_NAMESPACE} AND n.nspname<>'zuri_compact'),'[]'::jsonb)
 )`
export const COMPACT_CATALOG_SHA256 = `encode(sha256(convert_to((${CATALOG})::text,'UTF8')),'hex')`
export const COMPACT_DATABASE_INSPECTION = `SELECT jsonb_build_object(
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'oid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),'name',current_database(),'user',current_user,
 'objectCount',${COMPACT_OBJECT_COUNT},'markerExists',to_regclass('zuri_compact.installation') IS NOT NULL,
 'runtimeRoles',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'login',r.rolcanlogin,'inherit',r.rolinherit,
  'inheritsRuntime',CASE WHEN r.rolname='zuri_web_login' AND to_regrole('zuri_app_runtime') IS NOT NULL THEN pg_has_role(r.oid,to_regrole('zuri_app_runtime'),'USAGE') ELSE false END,
  'privilegedMembership',EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid WHERE m.member=r.oid AND (r.rolname<>'zuri_web_login' OR g.rolname<>'zuri_app_runtime' OR m.admin_option OR NOT m.inherit_option OR m.set_option)),
  'superuser',r.rolsuper,'bypass',r.rolbypassrls,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,'replication',r.rolreplication,
  'owner',pg_has_role(r.oid,(SELECT datdba FROM pg_database WHERE datname=current_database()),'MEMBER') OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND pg_has_role(r.oid,c.relowner,'MEMBER'))
 ) ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname IN ('zuri_app_runtime','zuri_web_login')),'[]'::jsonb),
 'catalogSha256',${COMPACT_CATALOG_SHA256})::text;`
export function compactInitializationSql({ manifest: m, target: t, observed: o, baseline }) {
  const state = { targetId: t.targetId, manifestSha256: digest(stableJson(m)), baselineSha256: m.schemaBaseline.sha256, releaseId: m.releaseId, sourceRevision: m.sourceRevision, systemIdentifier: o.database.systemIdentifier, databaseOid: o.database.oid }
  const tables = [...baseline.matchAll(/\bCREATE TABLE\s+(?:"public"\.)?"([A-Za-z][A-Za-z0-9_]*)"\s*\(/g)].map(row => row[1]).sort()
  if (!tables.length || new Set(tables).size !== tables.length) throw new Error('COMPACT_BASELINE_INVALID')
  // ON_ERROR_STOP + --single-transaction belong to psql's argv. This wrapper
  // has no transaction-ending SQL; the package's SQL scanner rejects escapes.
  return `\\set ECHO none
\\getenv compact_runtime_password COMPACT_RUNTIME_PASSWORD
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s';
DO $compact_lock$ BEGIN PERFORM pg_advisory_xact_lock(115,2); END $compact_lock$;
DO $compact_fresh$
BEGIN
 IF current_database()<>${literal(t.database.name)} OR current_user<>${literal(t.database.bootstrapRole)}
  OR (SELECT system_identifier::text FROM pg_control_system())<>${literal(o.database.systemIdentifier)}
  OR (SELECT oid::int FROM pg_database WHERE datname=current_database())<>${o.database.oid}
  OR ${COMPACT_OBJECT_COUNT}<>0
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('zuri_app_runtime','zuri_web_login')) THEN
  RAISE EXCEPTION 'COMPACT_FRESH_PRECONDITION_FAILED';
 END IF;
END $compact_fresh$;
${baseline}
ALTER ROLE zuri_web_login PASSWORD :'compact_runtime_password';
DO $compact_roles$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('zuri_app_runtime','zuri_web_login') AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolcanlogin<>(r.rolname='zuri_web_login') OR r.rolinherit<>(r.rolname='zuri_web_login') OR pg_has_role(r.oid,(SELECT datdba FROM pg_database WHERE datname=current_database()),'MEMBER')))
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('zuri_app_runtime','zuri_web_login'))<>2
  OR NOT pg_has_role('zuri_web_login','zuri_app_runtime','USAGE')
  OR EXISTS(SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member JOIN pg_roles g ON g.oid=a.roleid WHERE r.rolname IN ('zuri_app_runtime','zuri_web_login') AND (r.rolname<>'zuri_web_login' OR g.rolname<>'zuri_app_runtime' OR a.admin_option OR NOT a.inherit_option OR a.set_option))
  OR has_schema_privilege('zuri_web_login','public','CREATE')
  OR NOT has_database_privilege('zuri_web_login',current_database(),'CONNECT')
  OR has_database_privilege('zuri_web_login',current_database(),'CREATE')
  OR has_database_privilege('zuri_web_login',current_database(),'TEMPORARY')
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'compact_bootstrap'))
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (
    NOT has_table_privilege('zuri_web_login',c.oid,'SELECT') OR NOT has_table_privilege('zuri_web_login',c.oid,'INSERT')
    OR has_table_privilege('zuri_web_login',c.oid,'UPDATE')<>(c.relname NOT IN ('GovernanceSnapshot','ProjectFeatureMutationReceipt','PricingCalculation','MarketingExternalReport'))
    OR has_table_privilege('zuri_web_login',c.oid,'DELETE')<>(c.relname NOT IN ('GovernanceSnapshot','ProjectFeatureMutationReceipt','PricingCalculation','PricingRuleSet','MarketingExternalReport','MarketingReportPolicy','MarketingReportBinding'))
    OR has_table_privilege('zuri_web_login',c.oid,'TRUNCATE') OR has_table_privilege('zuri_web_login',c.oid,'REFERENCES') OR has_table_privilege('zuri_web_login',c.oid,'TRIGGER')))
  OR EXISTS(SELECT 1 FROM information_schema.table_privileges WHERE table_schema='public' AND grantee IN ('zuri_app_runtime','zuri_web_login') AND is_grantable='YES')
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND (NOT has_sequence_privilege('zuri_web_login',c.oid,'USAGE') OR NOT has_sequence_privilege('zuri_web_login',c.oid,'SELECT') OR NOT has_sequence_privilege('zuri_web_login',c.oid,'UPDATE')))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('zuri_web_login',p.oid,'EXECUTE'))
  OR (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>(SELECT count(*)+2 FROM pg_tables WHERE schemaname='public')
 THEN RAISE EXCEPTION 'COMPACT_RUNTIME_CONTRACT_FAILED'; END IF;
END $compact_roles$;
CREATE SCHEMA zuri_compact AUTHORIZATION compact_bootstrap;
REVOKE ALL ON SCHEMA zuri_compact FROM PUBLIC;
CREATE TABLE zuri_compact.installation(singleton boolean PRIMARY KEY CHECK(singleton),payload jsonb NOT NULL);
REVOKE ALL ON TABLE zuri_compact.installation FROM PUBLIC,zuri_app_runtime,zuri_web_login;
INSERT INTO zuri_compact.installation SELECT true,${literal(JSON.stringify(state))}::jsonb || jsonb_build_object('catalogSha256',${COMPACT_CATALOG_SHA256})
 WHERE (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_tables WHERE schemaname='public')=ARRAY[${tables.map(literal).join(',')}];
DO $compact_inventory$ BEGIN IF NOT EXISTS(SELECT 1 FROM zuri_compact.installation WHERE singleton=true) THEN RAISE EXCEPTION 'COMPACT_CATALOG_INVENTORY_MISMATCH'; END IF; END $compact_inventory$;
`
}
