// Fixed reading-order and Paddle HTML-table projection shared by the old and VL outputs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const require=createRequire(path.resolve('apps/server/package.json'));
const {parseFragment}=await import(pathToFileURL(require.resolve('parse5')));
const htmlText=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(htmlText).join(n.tagName==='br'?'\n':'');

export function pageRecords(raw){
 if(Array.isArray(raw))return raw.flatMap(pageRecords);
 if(raw&&Array.isArray(raw.raw))return raw.raw.flatMap(pageRecords);
 let value=raw;
 while(value&&value.res&&typeof value.res==='object')value=value.res;
 if(value&&Array.isArray(value.parsing_res_list))return [value];
 if(value&&Array.isArray(value.pages))return value.pages.flatMap(pageRecords);
 throw Error('Paddle result is missing page parsing_res_list');
}

export function tableRows(html){
 assert.equal(typeof html,'string','Table block content must be a string');
 const rows=[];
 const walk=n=>{
  if(n.tagName==='tr'){
   const row=(n.childNodes||[]).filter(c=>['td','th'].includes(c.tagName)).map(c=>({
    text:htmlText(c).replace(/\s+/gu,' ').trim(),
    rowspan:Number(c.attrs.find(a=>a.name==='rowspan')?.value||1),
    colspan:Number(c.attrs.find(a=>a.name==='colspan')?.value||1),
   }));
   if(row.length)rows.push(row);
  }else for(const c of n.childNodes||[])walk(c);
 };
 walk(parseFragment(html));
 assert.ok(rows.length>0,'Paddle table block did not contain an HTML row');
 return rows;
}

export function projectPages(inputPages){
 const pages=pageRecords(inputPages).sort((a,b)=>(a.page_index??0)-(b.page_index??0));
 const blocks=[],tables=[];
 for(const page of pages){
  const list=page.parsing_res_list;
  assert.ok(Array.isArray(list),'page parsing_res_list must be an array');
  for(const block of list){
   const body=typeof block.block_content==='string'?block.block_content:'';
   if(block.block_label==='table'){
    const rows=tableRows(body);
    const grid=[];
    rows.forEach((row,r)=>{
     grid[r]??=[];let c=0;
     for(const cell of row){
      while(grid[r][c]!==undefined)c++;
      for(let dr=0;dr<cell.rowspan;dr++)for(let dc=0;dc<cell.colspan;dc++){
       grid[r+dr]??=[];
       assert.equal(grid[r+dr][c+dc],undefined,'Overlapping HTML table spans');
       grid[r+dr][c+dc]=cell.text;
      }
      c+=cell.colspan;
     }
    });
    const table={page:page.page_index,rows,grid,text:rows.map(row=>row.map(cell=>cell.text).join('\t')).join('\n'),html:body};
    tables.push(table);blocks.push(table.text);
   }else blocks.push(body);
  }
 }
 return {text:blocks.join('\n'),tables,pages};
}
