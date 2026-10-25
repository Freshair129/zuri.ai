// Controlled parser-output adapter and chunking ablation. Never reads QA answers.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(path.resolve('apps/server/package.json'));
const {parseFragment}=await import(pathToFileURL(require.resolve('parse5')));
const root=path.resolve(process.argv[2] || '.local/oxr-thai-20261025');
const {parseGenesisRag17Document,genesisRag17BinaryParserIdentity,genesisRag17ParserIdentity}=await import(pathToFileURL(path.join(root,'text-parser-bundle.mjs')));
const words=new Intl.Segmenter('th',{granularity:'word'});
const sentences=new Intl.Segmenter('th',{granularity:'sentence'});
const graphemes=new Intl.Segmenter('th',{granularity:'grapheme'});
const norm=s=>s.normalize('NFKC').replace(/\s/gu,'');
const fits=s=>s.length<=480 && s.normalize('NFKC').length<=480 && s.trim().split(/\s+/u).length<=80;
const htmlText=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(htmlText).join(['tr','p','br'].includes(node.tagName)?'\n':'');
export function extract(content,format){
 if(format!=='html')return {text:content,tables:[]};
 const tree=parseFragment(content),tables=[];
 function visit(node){
  if(node.tagName==='table'){
   const rows=[];let complex=false;
   function rowWalk(n){if(n.tagName==='tr'){const cells=(n.childNodes||[]).filter(c=>['td','th'].includes(c.tagName));if(cells.some(c=>(c.attrs||[]).some(a=>['rowspan','colspan'].includes(a.name)&&a.value!=='1')))complex=true;rows.push(cells.map(c=>htmlText(c).replace(/\s+/gu,' ').trim()));}else for(const c of n.childNodes||[])rowWalk(c);}
   rowWalk(node);tables.push({rows,complex});
  }else for(const c of node.childNodes||[])visit(c);
 }visit(tree);
 return {text:htmlText(tree).trim(),tables};
}
function windows(text){
 // Preserve Thai word boundaries where possible and graphemes for long tokens.
 const units=[];
 for(const s of sentences.segment(text))for(const w of words.segment(s.segment)){
  if(fits(w.segment))units.push(w.segment);else units.push(...[...graphemes.segment(w.segment)].map(x=>x.segment));
 }
 const chunks=[];let active=[];
 for(const unit of units){
  if(!fits(active.join('')+unit)){
   if(active.join('').trim())chunks.push(active.join('').trim());
   let overlap=[];for(let i=active.length-1;i>=0;i--){if((active[i]+overlap.join('')).length>60)break;overlap.unshift(active[i]);}
   while(overlap.length&&!fits(overlap.join('')+unit))overlap.shift();active=overlap;
  }
  if(!fits(unit))throw Error('Unbounded grapheme');active.push(unit);
 }
 if(active.join('').trim())chunks.push(active.join('').trim());return chunks;
}
export function candidate(blocks){
 const result=[];
 for(const block of blocks){
  if(block.table && !block.table.complex && block.table.rows.length>1){
   const [header,...rows]=block.table.rows;
   for(const row of rows){const text=`${header.join(' | ')}\n${row.join(' | ')}`;
    if(fits(text))result.push({text,kind:'table-row',parts:[header.join(' | '),row.join(' | ')]});
    else for(const text of windows(row.join(' | ')))result.push({text,kind:'table-row-fragment'});
   }
  }else for(const text of windows(block.text))result.push({text,kind:'thai-word-window'});
 }
 return result;
}
export function currentChunks(text,id){
 return parseGenesisRag17Document({documentId:id,rawArtifactId:`raw-${id}`,content:text,maxTokens:80}).chunks.map(c=>({text:c.text,start:c.startOffset,end:c.endOffset}));
}
if(import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
const records=[];
for(const file of (await fs.readdir(path.join(root,'parsed'))).sort()){
 if(!/-(baseline|oxr|html-control)\.json$/.test(file))continue;
 const record=JSON.parse(await fs.readFile(path.join(root,'parsed',file),'utf8'));
 let text='',blocks=[],tables=[],status=record.status;
 if(['baseline','html-control'].includes(record.mode) && record.status==='OK'){
  text=record.output.normalizedText;tables=record.output.tables||[];
  let tableIndex=0;
  blocks=(record.output.textBlocks||[]).map(b=>({text:b.text,...(b.type==='html_table'?{table:tables[tableIndex++]}:{})}));if(!blocks.length&&text)blocks=[{text}];status='PARSED';
 }else if(record.mode==='oxr' && record.httpStatus===200 && record.output.code===0 && record.output.data?.error===null && Array.isArray(record.output.data?.result?.outputs?.json?.pages)){
  for(const page of record.output.data.result.outputs.json.pages)for(const b of page.blocks){
   const e=extract(String(b.content||''),b.format);tables.push(...e.tables);
   if(e.tables.length===1)blocks.push({text:e.text,table:e.tables[0],page:page.page_num,bbox:b.bbox});
   else blocks.push({text:e.text,page:page.page_num,bbox:b.bbox});
  }text=blocks.map(b=>b.table?b.table.rows.map(r=>r.join('\t')).join('\n'):b.text).join('\n');status='PARSED';
 }
 const [doc,variant]=record.id.split('-');
 let current=[],experimental=[];
 if(status==='PARSED'){
  current=currentChunks(text,record.id);
  experimental=candidate(blocks);for(const c of experimental)if(!fits(c.text))throw Error(`Candidate budget exceeded ${record.id}`);
 }
 records.push({id:record.id,doc,variant,parser:record.mode,status,error:record.error||record.output?.message,elapsedMs:record.elapsedMs,text,tables,blocks:blocks.length,chunks:{current,experimental}});
}
await fs.writeFile(path.join(root,'prepared.json'),JSON.stringify({candidate:'structure-thai-480-v1',icu:process.versions.icu,baselineBinaryIdentity:genesisRag17BinaryParserIdentity({mediaType:'application/pdf',maxTokens:80}),baselineTextIdentity:genesisRag17ParserIdentity({maxTokens:80}),records},null,2));
console.log(records.map(r=>({id:r.id,parser:r.parser,status:r.status,chars:r.text.length,chunks:r.chunks.current.length,candidate:r.chunks.experimental.length,tables:r.tables.length})));
}
