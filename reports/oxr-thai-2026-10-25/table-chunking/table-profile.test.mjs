import test from 'node:test';
import assert from 'node:assert/strict';
import {tablePackets} from './table-profile.mjs';
const c=(text,rowspan=1,colspan=1)=>({text,rowspan,colspan});
test('merged headers retain column spans and every row string including OCR mistakes',()=>{
 const table={rows:[[c('รายการ',2),c('ยอด',1,2)],[c('ก'),c('ข')],[c('ผิดOCR'),c('๑,20x'),c('2')],[c('สินค้า'),c('3'),c('4')]]};
 const r=tablePackets(table);
 assert.equal(r.headerRowCount,2);assert.equal(r.packets.length,2);
 assert.match(r.packets[0].text,/c2-3=ยอด/);assert.match(r.packets[0].text,/c2=ก/);
 assert.ok(r.packets[0].text.includes('\nผิดOCR\t๑,20x\t2\n'));
 assert.deepEqual(r.cells.filter(x=>x.row===2).map(x=>x.text),['ผิดOCR','๑,20x','2']);
 for(const p of r.packets)for(const s of p.sourceSpans){const cell=r.cells.find(c=>c.row===s.row&&c.cell===s.cell);assert.equal(p.text.slice(s.start,s.end),cell.text);}
});
test('never repairs or inherits headers from another page',()=>{
 const r=tablePackets({rows:[[c('รายการ'),c('สลับ'),c('ผิด')],[c('ทดสอบ'),c('1'),c('2')]]});
 assert.match(r.packets[0].text,/c2=สลับ/);assert.match(r.packets[0].text,/c3=ผิด/);
 const noHeader=tablePackets({rows:[[c('ทดสอบ'),c('1'),c('2')]]});
 assert.equal(noHeader.packets.length,0);assert.equal(noHeader.fallback.length,1);
});
test('oversize bodies preserve text but cannot claim atomic bundles',()=>{
 const r=tablePackets({rows:[[c('หัว'.repeat(300)),c('ค่า')],[c('รายการ'),c('123')]]});
 assert.equal(r.packets.length,0);assert.ok(r.fallback.some(x=>x.reason==='BUDGET_EXCEEDED'));
 assert.ok(r.fallback.some(x=>x.text.includes('123')));
});
test('invalid spans are rejected instead of silently changing columns',()=>{
 for(const span of [0,-1,1.5,Infinity,10001])assert.throws(()=>tablePackets({rows:[[c('h',1,span)]]}),/span/i);
});
test('headerless prose and large notes remain available as fallback',()=>{
 const r=tablePackets({rows:[[c('คำอธิบาย')],[c('ไม่ใช่ข้อมูลตัวเลข')]]});
 assert.equal(r.packets.length,0);assert.equal(r.fallback.length,2);
});
test('terminal empty cells survive native trimming inside a bounded packet',()=>{
 const r=tablePackets({rows:[[c('รายการ'),c('ก'),c('ข'),c('ค')],[c('ทดสอบ'),c('1'),c('2'),c('')]]});
 assert.equal(r.packets.length,1);const p=r.packets[0];
 assert.equal(p.text,p.text.trim());assert.ok(p.text.includes('\nทดสอบ\t1\t2\t\n'));
});
