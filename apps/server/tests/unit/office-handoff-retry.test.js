import {describe,it,expect} from 'vitest'
import {handoffCommand,replaceStaleCommand} from '@/modules/business/office-design/client-retry'

function storage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size},key:i=>[...values.keys()][i]}}
describe('office handoff retries after a popup closes',()=>{
 it('reuses the exact key and original expected version only for the same principal, workspace and archive',()=>{
  const db=storage(),args={principalId:'p1',workspaceId:'w1',archiveHash:'a'.repeat(64),version:0}
  const first=handoffCommand(db,args,()=> 'first-key')
  expect(handoffCommand(db,{...args,version:1},()=> 'new-key')).toEqual(first)
  expect(handoffCommand(db,{...args,principalId:'p2',version:1},()=> 'other-user')).toMatchObject({key:'other-user',version:1})
  expect(handoffCommand(db,{...args,archiveHash:'b'.repeat(64),version:1},()=> 'changed')).toMatchObject({key:'changed',version:1})
 })
 it('fails before a write when durable retry storage is unavailable or corrupt',()=>{
  expect(()=>handoffCommand({getItem(){throw Error('denied')}},{principalId:'p',workspaceId:'w',archiveHash:'a'.repeat(64),version:0},()=> 'key')).toThrow()
  const db=storage(),args={principalId:'p',workspaceId:'w',archiveHash:'a'.repeat(64),version:0};handoffCommand(db,args,()=> 'key');db.setItem(db.key(0),'broken')
  expect(()=>handoffCommand(db,args,()=> 'key2')).toThrow()
 })
 it('replaces a definitively stale command only if storage and newer version match',()=>{
  const db=storage(),args={principalId:'p',workspaceId:'w',archiveHash:'a'.repeat(64),version:0},old=handoffCommand(db,args,()=> 'old')
  expect(()=>replaceStaleCommand(db,args,old,0,()=> 'new')).toThrow()
  expect(replaceStaleCommand(db,args,old,2,()=> 'new')).toEqual({key:'new',version:2})
  expect(()=>replaceStaleCommand(db,args,old,3,()=> 'other')).toThrow()
  db.removeItem(db.key(0));expect(()=>replaceStaleCommand(db,args,old,3,()=> 'other')).toThrow();expect(db.length).toBe(0)
 })
})
