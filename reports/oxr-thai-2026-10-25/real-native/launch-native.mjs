// Disposable acceptance container only. Never load host environment files.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const env={...process.env};
for(const key of Object.keys(env))if(/^(POSTGRES_|DATABASE_POSTGRES_URL$|DATABASE_URL$|MSP_DB_PATH$|GKS_DB_PATH$|GENESIS_DB_PATH$|ZURI_MSP_|MSP_GKS_|MSP_PIPELINE_|GKS_PIPELINE_)/.test(key))delete env[key];
for(const key of ['KI17_MSP_ROOT','KI17_GKS_ROOT','KI17_GENESIS_ROOT','KI17_MODEL_DIR'])if(!env[key]||!fs.existsSync(env[key]))throw Error('Missing isolated runtime '+key);
fs.cpSync('/harness','/app/experiment',{recursive:true,errorOnExist:true,force:false});
const files=['/opt/ki17/pins/resolved.json','/opt/ki17/genesisblock/genesisrag17-worker/src/worker.mjs','/opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py','/app/prisma/schema.prisma','/app/src/platform/integrations/core/genesisrag17-executor.js','/app/tests/fixtures/genesisrag17-corpus-v1.json'];
const hashes=Object.fromEntries(files.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
fs.writeFileSync('/bench/runtime-provenance.json',JSON.stringify({node:process.version,hashes,pins:JSON.parse(fs.readFileSync('/opt/ki17/pins/resolved.json','utf8'))},null,2),{flag:'wx'});
const result=spawnSync(process.execPath,['scripts/assert-tests-ran.mjs','vitest','run','--config','experiment/native.config.mjs'],{cwd:'/app',env,stdio:'inherit'});
process.exit(result.status??1);
