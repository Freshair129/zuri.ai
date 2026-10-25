// Experimental preparation ONLY. Never reads evaluation gold or questions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {tablePackets} from './table-profile.mjs';
const require=createRequire(path.resolve('apps/server/package.json'));
const {parseFragment}=await import(pathToFileURL(require.resolve('parse5')));
const htmlText=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(htmlText).join(n.tagName==='br'?'\n':'');
function htmlRows(html){const rows=[];const walk=n=>{if(n.tagName==='tr')rows.push((n.childNodes||[]).filter(c=>['td','th'].includes(c.tagName)).map(c=>({text:htmlText(c).replace(/\s+/gu,' ').trim(),rowspan:Number(c.attrs.find(a=>a.name==='rowspan')?.value||1),colspan:Number(c.attrs.find(a=>a.name==='colspan')?.value||1)})));else for(const c of n.childNodes||[])walk(c);};walk(parseFragment(html));return rows;}
const old=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const manifest=await read('reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json');
const checked=async relative=>{const bytes=await fs.readFile(path.join(old,relative));assert.equal(hash(bytes),manifest.raw.find(r=>r.path===relative)?.sha256,'Frozen source changed: '+relative);return JSON.parse(bytes);};
const projected=await checked('projected.json'),oldInput=await checked('native-input.json');
const plain={...oldInput.arms.find(a=>a.parser==='paddle'),parser:'plain'};
const controlBytes=await fs.readFile('apps/server/tests/fixtures/genesisrag17-corpus-v1.json');
assert.equal(hash(controlBytes),oldInput.controlFileSha256);
let content=JSON.parse(controlBytes).text;const ranges=[],tables=[],packets=[],sourceSpans=[];
const append=(heading,text)=>{content+='\n\n## '+heading+'\n';const start=content.length;content+=text;return {start,end:content.length,textSha256:hash(text)};};
for(const d of projected.filter(d=>d.parser==='paddle')){
 const raw=await checked('paddle-1/'+d.id+'.json');
 content+='\n\n# Public PDF '+d.id+'\n\n';const docStart=content.length;let tableIndex=0,blockIndex=0;
 for(const page of raw.raw){const value=page.res||page;
  for(const b of value.parsing_res_list){
   if(b.block_label!=='table'){append(`${d.id} prose ${blockIndex++}`,b.block_content||'');continue;}
   const source=d.tables[tableIndex],profile=tablePackets(source),tableId=d.id+'-table-'+tableIndex;
   assert.deepEqual(htmlRows(b.block_content),source.rows,'Raw HTML/table-cell association mismatch');
   assert.equal(source.page,value.page_index);tables.push({id:tableId,doc:d.id,page:source.page,pdfSha256:d.pdfSha256,rawHtmlSha256:hash(b.block_content),cellRowsSha256:hash(JSON.stringify(source.rows)),...profile});
   const byRow=new Map(profile.packets.map(p=>[p.row,p]));
   for(let r=0;r<source.rows.length;r++){
    const packet=byRow.get(r),fallback=profile.fallback.find(f=>f.row===r);
    assert.ok(packet||fallback,'No source row may disappear');
    const text=packet?.text??fallback.text;
    const span=append(`${tableId} row ${r+1}`,text);
    if(packet)packets.push({tableId,doc:d.id,page:source.page,row:r,...span,...packet});
    let refs=packet?.sourceSpans;
    if(!refs){let offset=0;refs=source.rows[r].map((c,i)=>{const ref={kind:'fallback',row:r,cell:i,start:offset,end:offset+c.text.length};offset+=c.text.length+1;return ref;});}
    for(const ref of refs){const mapped={tableId,...ref,start:span.start+ref.start,end:span.start+ref.end};assert.equal(content.slice(mapped.start,mapped.end),source.rows[ref.row][ref.cell].text);sourceSpans.push(mapped);}
   }
   for(const c of profile.cells)assert.ok(sourceSpans.some(s=>s.tableId===tableId&&s.row===c.row&&s.cell===c.cell),'Specific source cell not retained');
   tableIndex++;
  }
 }
 assert.equal(tableIndex,d.tables.length);
 ranges.push({id:d.id,start:docStart,end:content.length,pdfSha256:d.pdfSha256,textSha256:hash(content.slice(docStart))});
}
const candidate={parser:'table',content,ranges,contentSha256:hash(content),packets};
await fs.mkdir(out,{recursive:true});
const write=(name,v)=>fs.writeFile(path.join(out,name),JSON.stringify(v,null,2),{flag:'wx'});
await write('native-input.json',{controlFileSha256:hash(controlBytes),arms:[plain,candidate]});
await write('table-sidecar.json',{profile:'ocr-table-row-v1',tables,packets,sourceSpans});
console.log(JSON.stringify({plainChars:plain.content.length,tableChars:content.length,packets:packets.length,tables:tables.map(t=>({id:t.id,headerRows:t.headerRowCount,packets:t.packets.length,fallback:t.fallback.reduce((a,f)=>(a[f.reason]=(a[f.reason]||0)+1,a),{})}))},null,2));
