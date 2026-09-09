// @spec FR-150 — portable package boundary; fixtures contain no real credential or model.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore package builder is a Node ESM release script.
import {assemblePackage,fileHash} from '../../scripts/package-desktop.mjs';

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zuri-desktop-package-'));
  for(const dir of ['edge/dist','edge/src-tauri','edge/state','edge/data'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'edge/dist/desktop-worker.js'),'export {};');
  fs.writeFileSync(path.join(root,'edge/src-tauri/tauri.conf.json'),JSON.stringify({version:'0.3.0'}));
  fs.writeFileSync(path.join(root,'edge/package.json'),JSON.stringify({name:'fixture',version:'0.1.0',scripts:{postinstall:'MUST_NOT_RUN'}}));
  fs.writeFileSync(path.join(root,'edge/package-lock.json'),'{}');
  fs.writeFileSync(path.join(root,'edge/.env'),'NEVER_COPY_SYNTHETIC');
  fs.writeFileSync(path.join(root,'edge/state/customer.json'),'NEVER_COPY_SYNTHETIC');
  fs.writeFileSync(path.join(root,'edge/data/business.db'),'NEVER_COPY_SYNTHETIC');
  fs.writeFileSync(path.join(root,'node.exe'),'synthetic-node');
  fs.writeFileSync(path.join(root,'desktop.exe'),'synthetic-desktop');
  return {root,edgeRoot:path.join(root,'edge'),outputDir:path.join(root,'portable'),nodePath:path.join(root,'node.exe'),desktopExe:path.join(root,'desktop.exe'),
    installDependencies:(worker:string)=>{fs.mkdirSync(path.join(worker,'node_modules','fixture'),{recursive:true});fs.writeFileSync(path.join(worker,'node_modules','fixture','index.js'),'export {};');}};
}
test('portable package covers runtime/worker/dependencies and excludes source state and install hooks',()=>{
  const input=fixture();const manifest=assemblePackage(input);
  assert.equal(manifest.nodeVersion,'v24.19.0');
  assert.ok(manifest.files.some((file:any)=>file.path==='runtime/node.exe'));
  assert.ok(manifest.files.some((file:any)=>file.path==='worker/dist/desktop-worker.js'));
  assert.ok(manifest.files.some((file:any)=>file.path==='worker/node_modules/fixture/index.js'));
  for(const file of manifest.files)assert.equal(file.sha256,fileHash(path.join(input.outputDir,file.path)));
  for(const name of ['.env','state','data'])assert.equal(fs.existsSync(path.join(input.outputDir,'worker',name)),false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(input.outputDir,'worker/package.json'),'utf8')).scripts,undefined);
  assert.throws(()=>assemblePackage(input),/new absolute directory/);
});
test('package refuses missing worker and credential-named files before copying the build',()=>{
  const input=fixture();fs.writeFileSync(path.join(input.edgeRoot,'dist/auth.json'),'synthetic-private');
  assert.throws(()=>assemblePackage(input),/Credential/);
  assert.equal(fs.existsSync(input.outputDir),false);
  const missing=fixture();fs.renameSync(path.join(missing.edgeRoot,'dist/desktop-worker.js'),path.join(missing.edgeRoot,'dist/not-an-entry.js'));
  assert.throws(()=>assemblePackage(missing),/Build Desktop and worker/);
});
