// Retain compact measurements and hashes; no generated report becomes product authority.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(process.argv[2] || '.local/oxr-thai-20261025');
const dest=process.argv[3]?path.resolve(process.argv[3]):path.dirname(fileURLToPath(import.meta.url));
await fs.mkdir(dest,{recursive:true});
const r=JSON.parse(await fs.readFile(path.join(root,'results.json'),'utf8'));
const groups=[];
for(const variant of ['digital','raster','html'])for(const parser of [...new Set(r.parsing.filter(x=>x.id.endsWith('-'+variant)).map(x=>x.parser))]){
 const all=r.parsing.filter(x=>x.id.endsWith('-'+variant)&&x.parser===parser),p=all.filter(x=>x.status==='PARSED');
 groups.push({variant,parser,expectedDocuments:all.length,measuredDocuments:p.length,failedDocuments:all.filter(x=>x.status!=='PARSED').map(x=>({id:x.id,status:x.status})),weightedCER:p.length?p.reduce((n,x)=>n+x.editDistance,0)/p.reduce((n,x)=>n+x.referenceChars,0):null,criticalMatches:p.reduce((n,x)=>n+x.criticalMatches,0),measuredCriticalTotal:p.reduce((n,x)=>n+x.criticalTotal,0),cellContentMatches:p.reduce((n,x)=>n+x.cellContentMatches,0),cellPositionMatches:p.reduce((n,x)=>n+x.cellPositionMatches,0),measuredCellTotal:p.reduce((n,x)=>n+x.cellTotal,0),elapsedMs:p.map(x=>x.elapsedMs)});
}
const summary={...r,parsingGroups:groups,arms:r.arms.map(a=>({...a,queryResults:a.queryResults.map(({top5,...q})=>({...q,top5:top5.map(({text,...x})=>x)}))}))};
await fs.writeFile(path.join(dest,'measurement-summary.json'),JSON.stringify(summary,null,2));
const names=['corpus.json','fixture-hashes.json','prepared.json','results.json','embedder.py','eval-final.log',...((await fs.readdir(root)).filter(f=>f.endsWith('.pdf'))),...((await fs.readdir(path.join(root,'parsed'))).map(f=>'parsed/'+f))];
const hashes={};for(const name of names)hashes[name]=createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
await fs.writeFile(path.join(dest,'evidence-manifest.json'),JSON.stringify({localEvidenceRoot:path.relative(process.cwd(),root).split(path.sep).join('/'),files:hashes},null,2));
console.log(JSON.stringify(groups,null,2));console.table(r.arms.map(({variant,parser,chunker,chunkCount,evidenceHit1,evidenceHit5,mrr,meanTop5Tokens})=>({variant,parser,chunker,chunkCount,evidenceHit1,evidenceHit5,mrr,meanTop5Tokens})));
