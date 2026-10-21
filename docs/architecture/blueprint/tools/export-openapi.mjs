import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
const output = process.argv[3];
if (!repo || !output) throw Error('Usage: node export-openapi.mjs <isolated-source> <output-directory>');
if (fs.existsSync(path.join(output,'../FROZEN.json'))) throw Error('Published package is frozen; create a new version instead.');
const require = createRequire(path.join(repo, 'apps/server/package.json'));
const esbuild = require('esbuild');
fs.mkdirSync(output, { recursive: true });
const bundledFile = path.join(output, 'openapi-generator.cjs');
const result = await esbuild.build({
  absWorkingDir: path.join(repo, 'apps/server'),
  stdin: { contents: "export { buildOpenApiDocument, CURRENT_API_ROUTE_INVENTORY } from './src/modules/project-manager/api-docs/openapi.js'; export * as persistedEnums from './src/lib/validation/enums.js'", resolveDir: path.join(repo, 'apps/server'), sourcefile: 'blueprint-export-entry.js' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: bundledFile,
  metafile: true, mainFields: ['module', 'main'], alias: { '@': path.join(repo, 'apps/server/src') },
  plugins: [{ name: 'prevent-db-construction-for-pure-document-export', setup(build) {
    build.onResolve({ filter: /(?:^@\/lib\/db$|(?:^|\/)lib\/db(?:\.js)?$)/ }, args => ({ path: args.path, namespace: 'no-db' }));
    build.onLoad({ filter: /.*/, namespace: 'no-db' }, () => ({ contents: "const denied = new Proxy({}, { get() { throw new Error('BLUEPRINT_EXPORT_DATABASE_ACCESS_DENIED') } }); export default denied; export const prisma = denied; export const databaseRuntime = null;", loader: 'js' }));
    build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export {};', loader: 'js' }));
  } }],
});
// The generated CJS lives outside node_modules; explicitly resolve externals from the isolated installation.
const module = { exports: {} };
const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(bundledFile, 'utf8'));
execute(require, module, module.exports, bundledFile, path.dirname(bundledFile));
fs.unlinkSync(bundledFile); // disposable bundle produced by this export; source hashes remain in evidence
const constants = Object.fromEntries(Object.entries(module.exports.persistedEnums).filter(([key,value]) => Array.isArray(value) ? value.every(v=>typeof v==='string'||typeof v==='number') : value && Object.getPrototypeOf(value)===Object.prototype && Object.values(value).every(v=>typeof v==='string'||typeof v==='number')));
fs.writeFileSync(path.join(output,'persisted-enum-constants.json'),JSON.stringify({source:'apps/server/src/lib/validation/enums.js',constants,scope:'Exact shared validation constants for existing persisted-string fields; accepted canonical clauses still govern target scope. Retired constants do not restore retired device behavior.'},null,2)+'\n');
const document = module.exports.buildOpenApiDocument({ serverUrl: '/' });
fs.writeFileSync(path.join(output, 'openapi.json'), JSON.stringify(document, null, 2) + '\n');
const methods = new Set(['get','post','put','patch','delete','head','options']);
const operations = Object.entries(document.paths).flatMap(([apiPath, item]) => Object.entries(item).filter(([method]) => methods.has(method)).map(([method, operation]) => ({ path: apiPath, method: method.toUpperCase(), operationId: operation.operationId ?? null, summary: operation.summary ?? null, contractCoverage: /intentionally not inferred|route coverage only|route inventory/i.test(JSON.stringify(operation)) ? 'ROUTE_INVENTORY_WITH_PARTIAL_DECLARATIONS' : 'DECLARED_OPENAPI_SCHEMA_REQUIRES_OWNING_AUTHORITY', untypedFieldsAreContractGaps: /intentionally not inferred|route coverage only|route inventory/i.test(JSON.stringify(operation)), security: operation.security ?? document.security ?? [], requestBody: operation.requestBody ?? null, responses: operation.responses ?? {}, source: 'apps/server/src/modules/project-manager/api-docs/openapi.js' })));
fs.writeFileSync(path.join(output, 'api-operations.json'), JSON.stringify(operations, null, 2) + '\n');
const dependencyHashes = Object.keys(result.metafile.inputs).filter(p => !p.startsWith('no-db:') && !p.startsWith('empty:') && !p.endsWith('blueprint-export-entry.js')).map(p => {
  const source = path.resolve(repo, 'apps/server', p);
  return { path: path.relative(repo, source).replaceAll('\\','/'), sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') };
});
fs.writeFileSync(path.join(output, 'openapi-export-evidence.json'), JSON.stringify({ mode: 'pure-builder-with-database-construction-denied', databaseCalls: 'forbidden-by-proxy', generator: 'buildOpenApiDocument', dependencies: dependencyHashes, openapiVersion: document.openapi, paths: Object.keys(document.paths).length, operations: operations.length, caveat: 'Static specification generation; not HTTP execution or live provider/runtime acceptance.' }, null, 2) + '\n');
console.log(JSON.stringify({ paths: Object.keys(document.paths).length, operations: operations.length, dependencies: dependencyHashes.length, output }));
