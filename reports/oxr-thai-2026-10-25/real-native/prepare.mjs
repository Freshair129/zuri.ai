// Projection adapter only: does not read the evaluation gold/questions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]);
const require=createRequire(path.resolve('apps/server/package.json'));
const {parseFragment}=await import(pathToFileURL(require.resolve('parse5')));
const hash=b=>createHash('sha256').update(b).digest('hex');
const frozen=JSON.parse(await fs.readFile(path.join(root,'frozen-inputs.json'),'utf8'));
const controlBytes=await fs.readFile('apps/server/tests/fixtures/genesisrag17-corpus-v1.json');
const control=JSON.parse(controlBytes);
const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join(n.tagName==='br'?'\n':'');
function table(html){
 const rows=[];const walk=n=>{if(n.tagName==='tr')rows.push((n.childNodes||[]).filter(c=>['td','th'].includes(c.tagName)).map(c=>({text:text(c).replace(/\s+/gu,' ').trim(),rowspan:Number(c.attrs.find(a=>a.name==='rowspan')?.value||1),colspan:Number(c.attrs.find(a=>a.name==='colspan')?.value||1)})));else for(const c of n.childNodes||[])walk(c);};walk(parseFragment(html));
 const grid=[];
 rows.forEach((row,i)=>{grid[i]??=[];let j=0;for(const cell of row){while(grid[i][j]!==undefined)j++;for(let r=0;r<cell.rowspan;r++)for(let c=0;c<cell.colspan;c++){grid[i+r]??=[];if(grid[i+r][j+c]!==undefined)throw Error('Overlapping table spans');grid[i+r][j+c]=cell.text;}j+=cell.colspan;}});
 return {rows,grid,text:rows.map(r=>r.map(c=>c.text).join('\t')).join('\n')};
}
const projections=[];
for(const parser of ['baseline','paddle'])for(const id of ['economy','population']){
 const raw=JSON.parse(await fs.readFile(path.join(root,parser+'-1',id+'.json'),'utf8'));
 const pdf=await fs.readFile(path.join(root,'input',id+'.pdf'));
 if(hash(pdf).toUpperCase()!==frozen.files[id+'.pdf']||raw.inputSha256!==hash(pdf))throw Error('Input hash changed');
 if(raw.status!=='PARSED')throw Error('Unmeasured parser source: '+parser+'/'+id);
 const tables=[];let projection;
 if(parser==='baseline')projection=raw.output.normalizedText;
 else {
  const blocks=[];
  for(const page of raw.raw){const value=page.res||page;if(!Array.isArray(value.parsing_res_list))throw Error('Missing blocks');for(const b of value.parsing_res_list){if(b.block_label==='table'){const t=table(b.block_content);tables.push({...t,page:value.page_index});blocks.push(t.text);}else blocks.push(b.block_content||'');}}
  projection=blocks.join('\n');
 }
 projections.push({parser,id,text:projection,textSha256:hash(projection),pdfSha256:hash(pdf),tables});
}
const arms=['baseline','paddle'].map(parser=>{
 let content=control.text;const ranges=[];
 for(const p of projections.filter(p=>p.parser===parser)){content+='\n\n# Public PDF '+p.id+'\n\n';const start=content.length;content+=p.text;ranges.push({id:p.id,start,end:content.length,pdfSha256:p.pdfSha256,textSha256:p.textSha256});}
 return {parser,content,ranges,contentSha256:hash(content)};
});
await fs.writeFile(path.join(root,'projected.json'),JSON.stringify(projections,null,2),{flag:'wx'});
await fs.writeFile(path.join(root,'native-input.json'),JSON.stringify({controlFileSha256:hash(controlBytes),arms},null,2),{flag:'wx'});
console.log(projections.map(p=>({parser:p.parser,id:p.id,chars:p.text.length,tables:p.tables.length})));
