// @req FR-085 — held work explains safe predecessors before a status attempt.
// @spec ADR-035, NFR-008
// @tested tests/e2e/pipeline-release-holds.spec.js
'use client'
import {useEffect,useState,useCallback} from 'react'
import {api} from './useApi'
export function workReleaseError(error) {
 if(error?.message==='RELEASE_HELD')return 'Release is held. Check handoff evidence before starting or finishing.'
 if(error?.message==='SCOPE_UNAVAILABLE')return 'The work or its handoff evidence is unavailable in your current scope.'
 return error?.message || 'Save failed'
}
export function useWorkRelease(id) {
 const [generation,setGeneration]=useState(0)
 const [result,setResult]=useState({id:null,loading:false,release:null,error:null})
 useEffect(()=>{
  let current=true
  if(!id){setResult({id:null,loading:false,release:null,error:null});return()=>{current=false}}
  setResult({id,loading:true,release:null,error:null})
  api(`/api/work/${id}`).then(release=>{if(current)setResult({id,loading:false,release,error:null})},error=>{if(current)setResult({id,loading:false,release:null,error:error.message})})
  return()=>{current=false}
 },[id,generation])
 const reload=useCallback(()=>setGeneration(value=>value+1),[])
 return {...(result.id===id?result:{loading:!!id,release:null,error:null}),reload}
}
export default function WorkReleaseNotice({release,loading=false,error=null,onReload}) {
 if(loading)return <span className="block text-xs text-muted" role="status">Checking handoff release…</span>
 if(error)return <span className="block text-xs" role="alert" style={{color:'var(--danger)'}}>Release unavailable. {onReload&&<button type="button" className="btn" onClick={onReload}>Reload release</button>}</span>
 if(!release?.held)return null
 return <span className="mt-2 block rounded-lg p-2 text-xs" style={{background:'var(--warning-bg)',color:'var(--text)'}}>
  <strong>Release held</strong>
  {release.restricted?<span className="block">Waiting for restricted handoff evidence.</span>:release.blockers.map(blocker=><span className="block" key={blocker.dependencyId}>
   Waiting for <a className="underline" href={blocker.predecessor.href}>{blocker.predecessor.label}</a>{blocker.reason==='EVIDENCE_UNAVAILABLE'?' — evidence unavailable.':'.'}
  </span>)}
  {release.truncated&&<span className="block">More handoffs are held. Open Dependencies to review them.</span>}
  {onReload&&<button type="button" className="btn mt-1" onClick={onReload}>Reload release</button>}
 </span>
}
