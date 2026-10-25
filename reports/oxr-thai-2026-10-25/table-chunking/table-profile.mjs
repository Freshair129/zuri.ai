// Pure experimental transformation. No files, model, gold, queries or corrections.
const numberLike=s=>/^[\s๐-๙0-9,.+\-%()]+$/u.test(s)&&/[๐-๙0-9]/u.test(s);
const dataLike=row=>row.filter(c=>numberLike(c.text)).length>=Math.max(1,Math.ceil((row.length-1)/2));
export function withinBudget(s){return s.length<=480&&s.normalize('NFKC').length<=480&&(s.match(/\S+/gu)||[]).length<=80;}
export function tablePackets(table){
 const rows=table.rows,cells=[],grid=[];
 if(!Array.isArray(rows)||rows.length>10000)throw Error('Invalid rows');
 rows.forEach((row,r)=>{grid[r]??=[];let col=0;
  for(let i=0;i<row.length;i++){
   const c=row[i];
   if(typeof c.text!=='string')throw Error('Cell text must be literal');
   for(const span of [c.rowspan,c.colspan])if(!Number.isInteger(span)||span<1||span>256)throw Error('Invalid span');
   while(grid[r][col]!==undefined)col++;
   if(col+c.colspan>256||r+c.rowspan>rows.length)throw Error('Span exceeds table bounds');
   const cell={row:r,cell:i,col,colEnd:col+c.colspan-1,rowEnd:r+c.rowspan-1,text:c.text};cells.push(cell);
   for(let dr=0;dr<c.rowspan;dr++)for(let dc=0;dc<c.colspan;dc++){
    grid[r+dr]??=[];if(grid[r+dr][col+dc]!==undefined)throw Error('Overlapping span');grid[r+dr][col+dc]=cell;
   }col+=c.colspan;
  }
 });
 const first=rows.findIndex(dataLike),headerRowCount=first<0?rows.length:first;
 const headers=cells.filter(c=>c.row<headerRowCount&&c.text);
 let headerText='';const headerSpans=[];
 for(const c of headers){if(headerText)headerText+='\n';headerText+=`h${c.row+1} c${c.col+1}${c.colEnd>c.col?'-'+(c.colEnd+1):''}=`;const start=headerText.length;headerText+=c.text;headerSpans.push({kind:'header',row:c.row,cell:c.cell,start,end:headerText.length});}
 const packets=[],fallback=[];
 rows.forEach((row,r)=>{
  const text=row.map(c=>c.text).join('\t');
  if(r<headerRowCount){fallback.push({row:r,text,reason:'HEADER_OR_PROSE'});return;}
  // Literal row stays inside delimiters so trailing empty columns are not trimmed.
  const body=headerText+'\n'+text+'\n[table-row-end]';
  const physical=cells.filter(c=>c.row===r);
  const reason=first<=0?'NO_HEADER':!dataLike(row)?'NON_DATA_ROW':physical.some(c=>c.rowEnd!==r||c.colEnd!==c.col)||grid[r].some(c=>c.row!==r)?'BODY_SPAN_UNSUPPORTED':!withinBudget(body)?'BUDGET_EXCEEDED':null;
  if(reason)fallback.push({row:r,text,reason});
  else {
   let offset=headerText.length+1;const sourceSpans=[...headerSpans];
   for(const c of physical){sourceSpans.push({kind:'data',row:r,cell:c.cell,start:offset,end:offset+c.text.length});offset+=c.text.length+1;}
   packets.push({row:r,text:body,rowText:text,sourceSpans,headerRefs:headers.map(c=>({row:c.row,cell:c.cell})),cellRefs:physical.map(c=>({row:c.row,cell:c.cell})),bindings:physical.map(c=>({col:c.col,cell:c.cell,headerRefs:headers.filter(h=>h.col<=c.col&&h.colEnd>=c.col).map(h=>({row:h.row,cell:h.cell}))}))});
  }
 });
 return {headerRowCount,cells,packets,fallback};
}
