// Blind adapter only: reads frozen PaddleOCR-VL JSON and two source PDFs, never gold/questions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tablePackets} from '../table-chunking/table-profile.mjs';
import {projectPages} from './paddle-html-adapter.mjs';

const raw=path.resolve(process.argv[2]||'.local/thai-paddleocr-vl-20261025');
const run=path.join(raw,'inference/attempt-2/model-output');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>fs.readFile(p);
const readJson=async p=>JSON.parse(await read(p));
const harnessLock=await readJson(path.join(raw,'harness-lock.json'));
const harnessLockSha=(await fs.readFile(path.join(raw,'harness-lock.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(path.join(raw,'harness-lock.json'))),harnessLockSha,'frozen harness lock digest mismatch');
assert.equal(harnessLock.status,'frozen-before-inference');
const amendmentBytes=await read(path.join(raw,'protocol-amendment.json'));
const amendmentSha=(await fs.readFile(path.join(raw,'protocol-amendment.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(amendmentBytes),amendmentSha,'frozen protocol amendment digest mismatch');
const amendment=JSON.parse(amendmentBytes);
assert.equal(amendment.pinnedHarness.sha256,harnessLockSha,'protocol amendment does not bind the harness lock');
for(const source of harnessLock.scripts){
 const file=path.resolve(process.cwd(),source.path);
 assert.equal(hash(await read(file)),source.sha256,`frozen harness source changed: ${source.path}`);
}
const protocol=await readJson(path.join(raw,'protocol.json'));
assert.equal(protocol.status,'frozen-before-model-bootstrap-and-inference');
const expectedProtocol=(await fs.readFile(path.join(raw,'protocol.sha256'),'utf8')).trim().split(/\s+/u)[0];
assert.equal(hash(await read(path.join(raw,'protocol.json'))),expectedProtocol);
assert.equal(amendment.amends.sha256,expectedProtocol,'protocol amendment binds a different protocol');
assert.equal(protocol.candidate.pipelineVersion,'v1');
assert.equal(protocol.candidate.releaseCommit,'0006f7874c334ce9c0f497d8b6cce9cdc0b7363d');
assert.equal(amendment.status,'frozen-before-inference');
const expectedPageCoverage=new Map(amendment.controls.pageCoverage.expected.map(x=>[x.id,x]));
const controlBytes=await fs.readFile('apps/server/tests/fixtures/genesisrag17-corpus-v1.json');
const control=JSON.parse(controlBytes);
const rawPages=[],documents=[];
for(const input of protocol.inputs.pdfs){
 const pdf=await read(input.path);assert.equal(hash(pdf),input.sha256,'frozen PDF hash mismatch');
 const directory=path.join(run,'repeat-1',input.id);
 const names=(await fs.readdir(directory)).filter(n=>n.endsWith('.json')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const expected=expectedPageCoverage.get(input.id);
 assert.ok(expected,`frozen expected page count missing for ${input.id}`);
 assert.equal(names.length,expected.count,`JSON result count does not match source PDF page count for ${input.id}`);
 const pages=[];
 for(const name of names){
  const data=await readJson(path.join(directory,name));
  pages.push(...(Array.isArray(data)?data:[data]));
 }
 const projected=projectPages(pages);
 assert.deepEqual(projected.pages.map(p=>p.page_index),expected.pageIndexes,`page_index coverage must be exact, unique and contiguous for ${input.id}`);
 assert.equal(projected.pages.length,expected.count,`projected page count does not match source PDF page count for ${input.id}`);
 rawPages.push({id:input.id,pages,projectionSha256:hash(projected.text)});
 documents.push({id:input.id,pdfSha256:input.sha256,text:projected.text,textSha256:hash(projected.text),tables:projected.tables.map(t=>({page:t.page,rows:t.rows,grid:t.grid}))});
}

let plainContent=control.text,tableContent=control.text;
const plainRanges=[],tableRanges=[],sideTables=[],packets=[],sourceSpans=[];
const append=(content,heading,body)=>{content+='\n\n## '+heading+'\n';const start=content.length;content+=body;return {content,start,end:content.length,textSha256:hash(body)};};
for(const doc of documents){
 plainContent+='\n\n# Public PDF '+doc.id+'\n\n';const plainStart=plainContent.length;
 tableContent+='\n\n# Public PDF '+doc.id+'\n\n';const tableStart=tableContent.length;
 let tableIndex=0,blockIndex=0;
 const input=rawPages.find(x=>x.id===doc.id);
 const pageProjection=projectPages(input.pages);
 for(const page of pageProjection.pages){
  for(const block of page.parsing_res_list){
   const body=typeof block.block_content==='string'?block.block_content:'';
   if(block.block_label!=='table'){
    const added=append(tableContent,`${doc.id} prose ${blockIndex++}`,body);
    tableContent=added.content;
    continue;
   }
   const source=doc.tables[tableIndex];
   assert.ok(source,`unexpected table block ${doc.id}/${tableIndex}`);
   const extracted=projectPages([{page_index:page.page_index,parsing_res_list:[block]}]).tables[0];
   assert.deepEqual(extracted.rows,source.rows,'table source changed during projection');
   assert.equal(source.page,page.page_index,'table page association changed');
   const profile=tablePackets(source),tableId=`${doc.id}-table-${tableIndex}`;
   sideTables.push({id:tableId,doc:doc.id,page:source.page,pdfSha256:doc.pdfSha256,rawHtmlSha256:hash(body),cellRowsSha256:hash(JSON.stringify(source.rows)),...profile});
   const byRow=new Map(profile.packets.map(p=>[p.row,p]));
   for(let r=0;r<source.rows.length;r++){
    const packet=byRow.get(r),fallback=profile.fallback.find(f=>f.row===r);
    assert.ok(packet||fallback,'no source row may disappear');
    const value=packet?.text??fallback.text;
    const added=append(tableContent,`${tableId} row ${r+1}`,value);tableContent=added.content;
    if(packet){
     const recorded={tableId,doc:doc.id,page:source.page,row:r,...added,...packet};
     packets.push(recorded);
     for(const ref of packet.sourceSpans){
      const span={tableId,...ref,start:added.start+ref.start,end:added.start+ref.end};
      assert.equal(tableContent.slice(span.start,span.end),source.rows[ref.row][ref.cell].text);
      sourceSpans.push(span);
     }
    }else{
     let offset=0;
     for(let cell=0;cell<source.rows[r].length;cell++){
      const text=source.rows[r][cell].text;
      const span={tableId,kind:'fallback',row:r,cell,start:added.start+offset,end:added.start+offset+text.length};
      assert.equal(tableContent.slice(span.start,span.end),text);
      sourceSpans.push(span);offset+=text.length+1;
     }
    }
   }
   for(const c of profile.cells)assert.ok(sourceSpans.some(s=>s.tableId===tableId&&s.row===c.row&&s.cell===c.cell),'source table cell not retained');
   tableIndex++;
  }
 }
 assert.equal(tableIndex,doc.tables.length);
 plainContent+=pageProjection.text;
 const plainEnd=plainContent.length,tableEnd=tableContent.length;
 plainRanges.push({id:doc.id,start:plainStart,end:plainEnd,pdfSha256:doc.pdfSha256,textSha256:hash(plainContent.slice(plainStart,plainEnd))});
 tableRanges.push({id:doc.id,start:tableStart,end:tableEnd,pdfSha256:doc.pdfSha256,textSha256:hash(tableContent.slice(tableStart,tableEnd))});
}
const arms=[
 {parser:'plain',content:plainContent,ranges:plainRanges,contentSha256:hash(plainContent)},
 {parser:'table',content:tableContent,ranges:tableRanges,contentSha256:hash(tableContent),packets},
];
const sidecar={profile:'ocr-table-row-v1',ocr:'PaddleOCR-VL v1 repetition 1',tables:sideTables,packets,sourceSpans};
const writeOnce=async(name,value)=>fs.writeFile(path.join(raw,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
await writeOnce('projected.json',documents.map(d=>({parser:'vl-v1',...d})));
await writeOnce('native-input.json',{protocolSha256:expectedProtocol,controlFileSha256:hash(controlBytes),arms});
await writeOnce('table-sidecar.json',sidecar);
const rawInventory=[];
async function walk(relative){const file=path.join(run,relative),stat=await fs.stat(file);if(stat.isDirectory()){for(const name of (await fs.readdir(file)).sort())await walk(path.join(relative,name));}else rawInventory.push({path:relative.replaceAll('\\','/'),bytes:stat.size,sha256:hash(await read(file))});}
for(const name of (await fs.readdir(run)).sort())await walk(name);
await writeOnce('inference-freeze.json',{protocolSha256:expectedProtocol,harnessLockSha256:harnessLockSha,protocolAmendmentSha256:amendmentSha,selectedRepetition:1,diagnosticRepetition:2,modelResults:rawInventory,projectorSha256:hash(await read('reports/oxr-thai-2026-10-25/paddleocr-vl-v1/paddle-html-adapter.mjs')),tableProfileSha256:hash(await read('reports/oxr-thai-2026-10-25/table-chunking/table-profile.mjs')),nativeInputSha256:hash(await read(path.join(raw,'native-input.json'))),projectedJsonSha256:hash(await read(path.join(raw,'projected.json'))),tableSidecarSha256:hash(await read(path.join(raw,'table-sidecar.json')))});
console.log(JSON.stringify({plainChars:plainContent.length,tableChars:tableContent.length,packets:packets.length,tables:sideTables.map(t=>({id:t.id,headerRows:t.headerRowCount,packets:t.packets.length,fallback:t.fallback.reduce((a,f)=>(a[f.reason]=(a[f.reason]||0)+1,a),{})})),rawFiles:rawInventory.length},null,2));
