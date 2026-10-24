// @req FR-082 — arbitrary container depth remains readable in the compatible tree.
// @spec ADR-035, SDD-019
import {it,expect} from 'vitest'
it('nests all levels, retaining direct items and stable IDs without mutating inputs',async()=>{
 const module=await import('@/modules/project-manager/application/structure-canvas')
 expect(typeof module.nestStructureContainers).toBe('function')
 const rows=[{id:'a',parentId:null,items:[]},{id:'b',parentId:'a',items:[]},{id:'c',parentId:'b',items:[{id:'item'}]}],copy=structuredClone(rows)
 const tree=module.nestStructureContainers(rows)
 expect(tree[0].children[0].children[0]).toMatchObject({id:'c',items:[{id:'item'}]})
 expect(rows).toEqual(copy)
})
