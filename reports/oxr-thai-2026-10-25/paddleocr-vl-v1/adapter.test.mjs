// Pre-inference adapter parity check against frozen original Paddle files only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {projectPages} from './paddle-html-adapter.mjs';

const oldRoot='.local/thai-native-20261025';
const oldProjection=JSON.parse(await fs.readFile(`${oldRoot}/projected.json`,'utf8'));
const oldInput=JSON.parse(await fs.readFile('.local/thai-table-chunking-20261025/run-v2/native-input.json','utf8'));
const control=JSON.parse(await fs.readFile('apps/server/tests/fixtures/genesisrag17-corpus-v1.json','utf8'));
let reconstructed=control.text;
for(const id of ['economy','population']){
 const raw=JSON.parse(await fs.readFile(`${oldRoot}/paddle-1/${id}.json`,'utf8'));
 const expected=oldProjection.find(p=>p.parser==='paddle'&&p.id===id);
 const adapted=projectPages(raw.raw);
 assert.equal(adapted.text,expected.text,`old Paddle adapter projection changed for ${id}`);
 assert.deepEqual(adapted.tables.map(t=>({page:t.page,rows:t.rows})),expected.tables.map(t=>({page:t.page,rows:t.rows})),`old Paddle table cells changed for ${id}`);
 reconstructed+='\n\n# Public PDF '+id+'\n\n'+adapted.text;
}
assert.equal(reconstructed,oldInput.arms.find(a=>a.parser==='plain').content,'frozen Paddle plain native arm assembly changed');
for(const arm of ['plain','table']){
 const old=oldInput.arms.find(a=>a.parser===arm);
 assert.ok(old&&old.contentSha256,'existing native arm should be available');
}
console.log('Paddle HTML reading-order/TSV adapter matches the frozen original parser projections and native plain arm for both PDFs.');
