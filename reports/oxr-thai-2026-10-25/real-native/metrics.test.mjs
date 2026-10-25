import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rowSupport,headerSupport,matchedCells,canonical,validateNativeRows} from './metrics.mjs';
test('Thai digits normalize but decimal/sign and values remain exact',()=>{
 assert.equal(canonical('๑,๒๓๔.๕๐'),'1,234.50');
 const r={label:'ดุลเงินสดรัฐบาล',values:['162.2','-91.4']};
 assert.ok(rowSupport('ดุลเงินสดรัฐบาล ๑๖๒.๒ -๙๑.๔',r));
 assert.equal(rowSupport('ดุลเงินสดรัฐบาล 162.2 91.4',r),false);
 assert.equal(rowSupport('ดุลเงินสดรัฐบาล 162.2 -91.40',r),false);
});
test('does not combine unrelated rows, numbers or chunks',()=>{
 const r={label:'จังหวัดบึงกาฬ',values:['488','401','889']};
 assert.equal(rowSupport('จังหวัดบึงกาฬ\nจังหวัดอื่น 488 401 889',r),false);
 assert.equal(rowSupport('จังหวัดบึงกาฬ 488 889 401',r),false);
 assert.equal(rowSupport('จังหวัดบึงกาฬ 488 401',r),false);
});
test('header presence cannot mistake non-Thai for Thai or overall total for subtotal',()=>{
 assert.equal(headerSupport('ไม่ได้สัญชาติไทย รวมทั้งสิ้น',['สัญชาติไทย','รวม']),false);
 assert.ok(headerSupport('สัญชาติไทย ชาย หญิง รวม',['สัญชาติไทย','รวม']));
});
test('structured cells require correct offset after row label',()=>{
 const r={label:'จังหวัดบึงกาฬ',values:['488','401','889']};
 assert.equal(matchedCells([{grid:[['27','จังหวัดบึงกาฬ','๔๘๘','๔๐๑','๘๘๙']]}],r),3);
 assert.equal(matchedCells([{grid:[['27','จังหวัดบึงกาฬ','401','488','889']]}],r),1);
});
test('native validation rejects duplicate/missing tuples, oversized topK and swapped input',()=>{
 const gold={documents:[{id:'d',qa:[{id:'q'}]}]},arm={parser:'p',contentSha256:'h'};
 const result=()=>({arm:'p',inputHash:'h',successfulStages:17,queries:[1,2,3].map(n=>({doc:'d',id:'q',repetition:n,elapsedMs:1,response:{results:[]}}))});
 validateNativeRows(result(),arm,gold);
 let r=result();r.queries[2]=r.queries[1];assert.throws(()=>validateNativeRows(r,arm,gold),/Duplicate/);
 r=result();r.queries.pop();assert.throws(()=>validateNativeRows(r,arm,gold),/Missing/);
 r=result();r.queries[0].response.results=Array(6).fill({});assert.throws(()=>validateNativeRows(r,arm,gold),/topK/);
 r=result();r.arm='other';assert.throws(()=>validateNativeRows(r,arm,gold),/different parser/);
 r=result();r.inputHash='stale';assert.throws(()=>validateNativeRows(r,arm,gold),/different input/);
});
