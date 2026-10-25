// Parser-output adapter only. No reference text, questions, or answer labels.
import fs from 'node:fs/promises';
import path from 'node:path';
import {candidate,currentChunks,extract} from '../prepare.mjs';
const root=path.resolve(process.argv[2]);
const baseline=path.resolve(process.argv[3]||'.local/oxr-thai-20261025');
const original=JSON.parse(await fs.readFile(path.join(baseline,'prepared.json'),'utf8'));
function doclingBlocks(raw){
 const visited=new Set(),blocks=[];
 const resolve=ref=>ref.split('/').slice(1).reduce((o,k)=>o[k],raw);
 function walk(ref){
  if(visited.has(ref))return;visited.add(ref);
  const item=resolve(ref);
  if(item.data?.table_cells){
   const rows=Array.from({length:item.data.num_rows},()=>Array(item.data.num_cols).fill(''));
   let complex=false;
   for(const cell of item.data.table_cells){
    const r=cell.start_row_offset_idx,c=cell.start_col_offset_idx;
    if(r<0||r>=rows.length||c<0||c>=rows[r].length)throw Error('Cell outside declared table');
    rows[r][c]=cell.text;
    if(cell.row_span!==1||cell.col_span!==1)complex=true;
   }
   blocks.push({text:rows.map(r=>r.join('\t')).join('\n'),table:{rows,complex},provenance:item.prov});
  }else if(typeof item.text==='string')blocks.push({text:item.text,provenance:item.prov});
  for(const child of item.children||[])walk(child.$ref);
 }
 for(const child of raw.body.children)walk(child.$ref);
 return blocks;
}
function paddleBlocks(raw){
 const blocks=[];
 for(const page of raw){
  const value=page.res||page;
  if(!Array.isArray(value.parsing_res_list))throw Error('Missing Paddle parsing_res_list');
  for(const b of value.parsing_res_list){
   const parsed=extract(b.block_content||'',b.block_label==='table'?'html':'text');
   if(parsed.tables.length>1)throw Error('Unexpected multiple tables in one block');
   const table=parsed.tables[0];
   blocks.push({text:table?table.rows.map(r=>r.join('\t')).join('\n'):parsed.text,...(table?{table}:{}),unparsedTable:b.block_label==='table'&&!table,bbox:b.block_bbox,page:value.page_index});
  }
 }
 return blocks;
}
const records=[...original.records];
for(const parser of ['docling','paddle','paddle1280'])for(const file of (await fs.readdir(path.join(root,'parsed'))).filter(n=>n.endsWith('-'+parser+'.json')).sort()){
 const r=JSON.parse(await fs.readFile(path.join(root,'parsed',file),'utf8'));
 const [doc,variant]=r.id.split('-');
 const blocks=r.status==='PARSED'?(parser==='docling'?doclingBlocks(r.raw):paddleBlocks(r.raw)):[];
 const text=blocks.map(b=>b.text).join('\n');
 const tables=blocks.filter(b=>b.table).map(b=>b.table);
 records.push({id:r.id,doc,variant,parser,status:r.status,elapsedMs:r.elapsedMs,error:r.error,text,tables,blocks:blocks.length,unparsedTableBlocks:blocks.filter(b=>b.unparsedTable).length,chunks:{current:text?currentChunks(text,r.id):[],experimental:text?candidate(blocks):[]}});
}
await fs.writeFile(path.join(root,'prepared.json'),JSON.stringify({...original,records},null,2));
console.table(records.map(r=>({id:r.id,parser:r.parser,status:r.status,chars:r.text.length,tables:r.tables.length,current:r.chunks.current.length,experimental:r.chunks.experimental.length})));
