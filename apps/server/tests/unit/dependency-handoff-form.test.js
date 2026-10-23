// @req FR-084 — mandatory contract fields and explicit preview before mutation.
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {it,expect,vi} from 'vitest'
import {NewDependencyModal, dependencyRegisterProjects} from '@/modules/project-manager/views/universal/DependenciesView'
globalThis.React=React
it('renders mandatory deliverable, acceptance and preview; confirmation is unavailable before preview',()=>{const html=renderToStaticMarkup(React.createElement(NewDependencyModal,{open:true,onClose:()=>{}}));expect(html).toContain('aria-label="Source type"');expect(html).toContain('aria-label="Source Project code"');expect(html).toContain('aria-label="Deliverable"');expect(html).toContain('Deliverable');expect(html).toContain('Acceptance');expect(html).toContain('Preview handoff');expect(html).not.toContain('Confirm handoff')})

it('resolves both existing endpoint Projects independently of Business or Project view',async()=>{
 const dependency={source:{type:'WORK_ITEM',id:'item-a',code:'A'},target:{type:'WORKSTREAM',id:'stream-b',code:'B'}}
 const resolve=vi.fn(async(type,code)=>code==='A'?{id:'item-a',projectId:'project-z'}:{id:'stream-b',projectId:'project-a'})
 for(const projectId of [undefined,'project-z']) expect(await dependencyRegisterProjects({dependency,projectId,resolve})).toEqual(['project-a','project-z'])
 expect(resolve.mock.calls.every(call=>call[2]===true)).toBe(true)
})
it('refuses changed endpoint bindings instead of targeting a replacement code',async()=>{
 const dependency={source:{type:'PROJECT',id:'old',code:'A'},target:{type:'PROJECT',id:'b',code:'B'}}
 await expect(dependencyRegisterProjects({dependency,resolve:async()=>({id:'replacement',projectId:'replacement'})})).rejects.toThrow('Reload')
})
