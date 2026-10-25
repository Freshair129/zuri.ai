export const digits=s=>s.normalize('NFKC').replace(/[๐-๙]/gu,c=>String(c.charCodeAt(0)-0x0e50));
export const canonical=s=>digits(s).replace(/\s/gu,'');
export const numericTokens=s=>digits(s).match(/[-+]?\d[\d,]*(?:\.\d+)?/gu)||[];
// Require a complete selected row on one parser-projected line. Never accept
// a matching number elsewhere or combine pieces across retrieved chunks.
export function rowSupport(text,row){
 return text.split(/\r?\n/u).some(line=>canonical(line).includes(canonical(row.label))&&JSON.stringify(numericTokens(line).slice(-row.values.length))===JSON.stringify(row.values));
}
export function headerSupport(text,headers){
 return headers.every(h=>{let value=canonical(text);if(h==='สัญชาติไทย')value=value.replaceAll(canonical('ไม่ได้สัญชาติไทย'),'');if(h==='รวม')value=value.replaceAll(canonical('รวมทั้งสิ้น'),'');return value.includes(canonical(h));});
}
export function matchedCells(tables,row){
 let best=0;
 for(const table of tables)for(const cells of table.grid){
  const index=cells.findIndex(c=>canonical(c||'').includes(canonical(row.label)));if(index<0)continue;
  const score=row.values.filter((v,i)=>canonical(cells[index+1+i]||'')===v).length;best=Math.max(best,score);
 }
 return best;
}
import assert from 'node:assert/strict';
export function validateNativeRows(result,arm,gold){
 assert.equal(result.arm,arm.parser,'Result belongs to a different parser');
 assert.equal(result.inputHash,arm.contentSha256,'Result belongs to a different input');
 assert.equal(result.successfulStages,17);
 const expected=new Map(gold.documents.flatMap(d=>d.qa.flatMap(q=>[1,2,3].map(n=>[`${d.id}/${q.id}/${n}`,true]))));
 for(const q of result.queries){
  const key=`${q.doc}/${q.id}/${q.repetition}`;
  assert.ok(expected.delete(key),'Duplicate or unknown query tuple: '+key);
  assert.ok(Number.isFinite(q.elapsedMs)&&q.elapsedMs>=0);
  assert.ok(Array.isArray(q.response.results)&&q.response.results.length<=5,'Results exceed requested topK');
 }
 assert.equal(expected.size,0,'Missing query tuples');
}
