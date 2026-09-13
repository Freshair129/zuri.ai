// @spec FR-150 — a portable Desktop includes its pinned Node runtime and verified worker files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = 'v24.19.0';
export function fileHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
export function filesIn(root) {
  return fs.readdirSync(root, { withFileTypes:true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(item=>{
    const file=path.join(root,item.name);
    if (item.isSymbolicLink()) throw Error('Package must not contain symbolic links');
    return item.isDirectory() ? filesIn(file) : [file];
  });
}
export function assemblePackage({edgeRoot,outputDir,nodePath,desktopExe,installDependencies}) {
  if (!path.isAbsolute(outputDir) || fs.existsSync(outputDir)) throw Error('Package output must be a new absolute directory');
  const entry=path.join(edgeRoot,'dist','desktop-worker.js');
  if (!fs.existsSync(entry) || !fs.existsSync(desktopExe) || !fs.existsSync(nodePath)) throw Error('Build Desktop and worker before packaging');
  for (const file of filesIn(path.join(edgeRoot,'dist'))) {
    if (/^(?:\.env(?:\..*)?|auth\.json|\.credential\.json)$/.test(path.basename(file))) throw Error('Credential/config file found in build output');
  }
  const version=JSON.parse(fs.readFileSync(path.join(edgeRoot,'src-tauri','tauri.conf.json'),'utf8')).version;
  const runtime=path.join(outputDir,'runtime'),worker=path.join(outputDir,'worker');
  fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(worker);
  fs.copyFileSync(nodePath,path.join(runtime,'node.exe'));
  fs.copyFileSync(desktopExe,path.join(outputDir,'zuri-edge-device.exe'));
  fs.cpSync(path.join(edgeRoot,'dist'),path.join(worker,'dist'),{recursive:true,dereference:false});
  // Persona folders ride with the worker; without them the packaged worker answers from persona.ts's fallback string.
  const agents=path.join(edgeRoot,'.agents');
  if (fs.existsSync(agents)) fs.cpSync(agents,path.join(worker,'.agents'),{recursive:true,dereference:false});
  const pkg=JSON.parse(fs.readFileSync(path.join(edgeRoot,'package.json'),'utf8'));
  delete pkg.scripts;
  fs.writeFileSync(path.join(worker,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  fs.copyFileSync(path.join(edgeRoot,'package-lock.json'),path.join(worker,'package-lock.json'));
  installDependencies(worker);
  const files=filesIn(outputDir).map(file=>{
    const relative=path.relative(outputDir,file).split(path.sep).join('/');
    if (relative.split('/').some(name=>name==='.env'||name.startsWith('.env.')||name==='auth.json'||name==='.credential.json')) throw Error('Credential/config file found in package');
    return {path:relative,sha256:fileHash(file)};
  });
  const manifest={version:1,desktopVersion:version,nodeVersion:NODE_VERSION,files};
  fs.writeFileSync(path.join(outputDir,'README.txt'),[
    'Zuri Edge Device '+version,'',
    'Extract the entire ZIP to a writable local directory and open zuri-edge-device.exe.',
    'Use the left sidebar: Connect to pair, AI to configure Ollama/Codex/Claude, then Overview to Start.',
    'The computer name and hardware inventory are read locally on startup; Overview > Machine specifications shows details.',
    'Use Previous/Next for long lists and compact pages. The minimum supported client area is 640 x 480 logical pixels.',
    'Requires Windows WebView2, matching Zuri Server pairing routes and local RAG service.',
    'Ollama and Codex/Claude CLIs are installed separately; this package does not contain models or accounts.',
    'Stop before changing device or provider. Closing Desktop requests graceful worker shutdown.',
    'Automatic updates are not enabled in this portable package. Obtain a new complete package from your administrator.',
    'This package contains no device credentials, provider credentials or business data.','',
  ].join('\r\n'));
  manifest.files.push({path:'README.txt',sha256:fileHash(path.join(outputDir,'README.txt'))});
  fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
function runNodeScript(node,script,args,cwd) {
  const result=spawnSync(node,[script,...args],{cwd,stdio:'inherit',windowsHide:true,shell:false});
  if(result.error||result.status!==0)throw Error('Package dependency/build command failed');
}
function main() {
  if(process.platform!=='win32'||process.arch!=='x64'||process.version!==NODE_VERSION)throw Error('Package with Windows x64 Node '+NODE_VERSION);
  const edgeRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const outputDir=path.resolve(process.argv[2]||path.join(edgeRoot,'dist-desktop','0.3.1'));
  const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  if(!fs.existsSync(npm))throw Error('Use the pinned Node distribution containing npm');
  runNodeScript(process.execPath,npm,['run','build'],edgeRoot);
  const manifest=assemblePackage({edgeRoot,outputDir,nodePath:process.execPath,
    desktopExe:path.join(edgeRoot,'src-tauri','target','release','zuri-edge-device.exe'),
    installDependencies:worker=>runNodeScript(process.execPath,npm,['ci','--omit=dev','--no-audit','--no-fund'],worker)});
  console.log(JSON.stringify({outputDir,desktopVersion:manifest.desktopVersion,nodeVersion:manifest.nodeVersion,files:manifest.files.length}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
