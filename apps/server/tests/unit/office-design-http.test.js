// @req FR-294 — intake is reserved before buffering, and released on all outcomes.
import {describe,it,expect} from 'vitest'
import {readOfficeBody,withOfficeUploadSlot} from '@/modules/business/office-design/http'
import {assertOfficeGraphBudget} from '@/modules/business/office-design/graph-budget.mjs'
describe('Office receiver intake bounds',()=>{
 it('refuses the third concurrent intake before running its reader',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve}),a=withOfficeUploadSlot(()=>blocked),b=withOfficeUploadSlot(()=>blocked);let read=false
  await expect(withOfficeUploadSlot(()=>{read=true})).rejects.toMatchObject({status:503});expect(read).toBe(false)
  release();await Promise.all([a,b]);await expect(withOfficeUploadSlot(()=>Promise.reject(Error('aborted')))).rejects.toThrow('aborted');expect(await withOfficeUploadSlot(()=>42)).toBe(42)
 })
 it('refuses announced oversize before reading and cancels a stream when it crosses the byte bound',async()=>{
  let read=false
  await expect(readOfficeBody({headers:new Headers({'content-type':'application/zip','content-length':'100000001'}),get body(){read=true;throw Error('read')}})).rejects.toMatchObject({status:413});expect(read).toBe(false)
  let cancelled=false,n=0;const chunk=new Uint8Array(10_000_000),body=new ReadableStream({pull(c){n++;c.enqueue(chunk)},cancel(){cancelled=true}})
  await expect(readOfficeBody({headers:new Headers({'content-type':'application/zip'}),body})).rejects.toMatchObject({status:413});expect(cancelled).toBe(true);expect(n).toBeLessThanOrEqual(12)
 })
 it('rejects expanded catalog work in one preflight pass before expensive producer semantics',()=>{
  expect(()=>assertOfficeGraphBudget({entities:Array.from({length:16},()=>({type:'workflow'}))})).toThrow('OFFICE_GRAPH_BUDGET')
  expect(()=>assertOfficeGraphBudget({entities:Array.from({length:64},()=>({type:'workflowStep'}))})).toThrow('OFFICE_GRAPH_BUDGET')
 })
})
