'use client'
// @req FR-082 — accessible create/reparent, prospective drop targets and audited recovery.
// @spec ADR-035, SDD-046, NFR-008
// @tested tests/e2e/pipeline-structure-editing.spec.js, tests/unit/pipeline-structure-interactions.test.js
import { useEffect, useRef, useState } from 'react'
import { EXECUTION_MODES, MODE_LABELS } from '@/lib/validation/enums'
import catalogue from '../../../../contracts/pipeline-execution-catalog.v1.json'
import { createNodePlan, moveNodePlan } from './pipeline-structure-interactions'
import { projectPlan, submitPipelinePlan, pipelineMessage, pointerMoved } from './pipeline-edge-interactions'
import WorkpackageModal from './WorkpackageModal'
import s from '../views/wbs.module.css'

const structureMessage=error=>({INVALID_PARENT:'That parent would break the work hierarchy. Choose another destination.',MODE_INCOMPATIBLE:'This work does not fit the destination’s execution mode.',GRAPH_BUSY:'The Project is busy. Retry shortly.'}[error.code]||pipelineMessage(error))
async function readCanvas(projectId,move){
  const query=move?`&moveType=${encodeURIComponent(move.type)}&moveId=${encodeURIComponent(move.id)}`:''
  const response=await fetch(`/api/projects/${projectId}/tree?canvas=1${query}`)
  if(!response.ok)throw Object.assign(new Error('Structure could not be loaded.'),{status:response.status})
  const next=await response.json()
  if(next.projectId!==projectId||!Array.isArray(next.nodes)||next.move?.id!==move?.id)throw new Error('Structure scope changed.')
  return next
}
export default function StructureCanvas({projectId,fallback}){
  const [canvas,setCanvas]=useState(null),[readOnly,setReadOnly]=useState(false),[error,setError]=useState(null)
  const [dialog,setDialog]=useState(null),[phase,setPhase]=useState('idle'),[receipt,setReceipt]=useState(null),[moving,setMoving]=useState(null),[item,setItem]=useState(null)
  const ticket=useRef(0),reads=useRef(0),recovery=useRef(null),attempt=useRef(null),drag=useRef(null),trigger=useRef(null),live=useRef(true)
  const busy=phase==='pending'||phase==='committing',uncertain=phase==='refused'&&recovery.current?.expectedPreviewHash!=null
  const focusBack=()=>requestAnimationFrame(()=>{
    const buttons=[...document.querySelectorAll('[data-structure-action]')]
    ;(buttons.find(button=>button.dataset.structureAction===trigger.current)||buttons[0])?.focus()
  })
  const load=async()=>{
    const current=++reads.current
    try{const next=await readCanvas(projectId);if(!live.current||current!==reads.current)return false;setCanvas(next);setReadOnly(false);return true}
    catch(failure){if(!live.current||current!==reads.current)return false;if([403,404].includes(failure.status)){setReadOnly(true);return false}throw failure}
  }
  useEffect(()=>{
    live.current=true;setCanvas(null);setReadOnly(false);setDialog(null);setReceipt(null);setError(null);setPhase('idle');recovery.current=null;attempt.current=null;drag.current=null;setMoving(null)
    load().catch(()=>{if(live.current)setError('Structure could not be loaded. Reload the Project.')})
    return()=>{live.current=false;reads.current++;ticket.current++}
  },[projectId])
  const cancel=()=>{ticket.current++;reads.current++;drag.current=null;setMoving(null);setDialog(null);attempt.current=null;recovery.current=null;setError(null);setPhase('idle');focusBack()}
  const execute=async plan=>{
    const current=++ticket.current;reads.current++;drag.current=null;setMoving(null);setDialog(null);setError(null);setPhase('pending');recovery.current=plan
    try{
      const result=await submitPipelinePlan(plan,{isCurrent:()=>live.current&&ticket.current===current,onPreview:accepted=>{recovery.current=accepted;setPhase('committing')}})
      if(!result||!live.current||ticket.current!==current)return
      if(result.committed!==true)throw Object.assign(new Error('Refused'),{code:result.errors?.[0]?.code||'REFUSED',definitive:result.committed===false})
      recovery.current=null;setReceipt(result);attempt.current=null
      try{if(!await load())return}catch{setError('Saved. Reload the Project to see the latest structure.')}
      if(live.current&&ticket.current===current){setPhase('saved');focusBack()}
    }catch(failure){
      if(!live.current||ticket.current!==current)return
      const unknown=recovery.current?.expectedPreviewHash!=null&&failure.definitive!==true
      if(!unknown)recovery.current=null
      setError(unknown?'The save result is uncertain. Retry to recover the same structure change.':structureMessage(failure));setPhase('refused');focusBack()
    }
  }
  const prepareMove=async(node,showDialog=true)=>{
    if(busy||uncertain)return
    const current=++reads.current;setError(null)
    try{
      const next=await readCanvas(projectId,{type:node.type,id:node.id})
      if(!live.current||current!==reads.current)return
      setCanvas(next)
      if(showDialog){attempt.current={kind:'move',id:node.id};setDialog(attempt.current)}
      else if(drag.current?.id===node.id){drag.current.canvas=next;setMoving(previous=>previous?{...previous,ready:true}:previous)}
    }catch{if(live.current&&current===reads.current){drag.current=null;setMoving(null);setError('Destinations could not be checked. Reload the Project.')}}
  }
  const beginMove=(node,button)=>{if(busy||uncertain)return;trigger.current=button.dataset.structureAction;prepareMove(node)}
  const beginCreate=(node,button)=>{if(busy||uncertain)return;trigger.current=button.dataset.structureAction;reads.current++;attempt.current={kind:'create',parentId:node.id};setError(null);setDialog(attempt.current)}
  const startDrag=(event,node)=>{
    if(busy||uncertain||event.button!==0)return
    trigger.current=event.currentTarget.dataset.structureAction
    drag.current={id:node.id,start:{x:event.clientX,y:event.clientY},active:false,canvas:null};setMoving({id:node.id,active:false,ready:false});prepareMove(node,false)
  }
  useEffect(()=>{
    const move=event=>{const current=drag.current;if(current&&!current.active&&pointerMoved(current.start,{x:event.clientX,y:event.clientY})){current.active=true;setMoving(value=>value?{...value,active:true}:value)}}
    const up=event=>{
      const current=drag.current;drag.current=null;setMoving(null)
      if(!current?.active||!current.canvas)return
      const parentId=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-structure-card]')?.dataset.structureTarget
      if(!current.canvas.targets.some(target=>target.id===parentId))return
      attempt.current={kind:'move',id:current.id};execute(moveNodePlan(current.canvas,current.id,parentId))
    }
    const escape=event=>{if(event.key==='Escape'&&drag.current){reads.current++;drag.current=null;setMoving(null);focusBack()}}
    const stop=()=>{reads.current++;drag.current=null;setMoving(null)}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',stop);window.addEventListener('keydown',escape)
    return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',stop);window.removeEventListener('keydown',escape)}
  },[projectId,phase])
  const reload=async()=>{try{if(await load()&&phase==='saved')setError(null)}catch{setError(previous=>previous||'Structure could not be loaded. Reload the Project.')}}
  if(readOnly)return fallback
  if(!canvas)return <div className={s.state}>{error?<p role="alert">{error}</p>:<p role="status">Structure Plan loading</p>}<button className="btn" onClick={reload}>Reload Project</button></div>
  const root=canvas.nodes.find(node=>node.type==='PROJECT')
  const children=id=>canvas.nodes.filter(node=>node.parentId===id)
  const renderNode=node=>{
    const nested=children(node.id),mayAdd=node.type!=='WORK_ITEM',mayMove=['WORK_CONTAINER','WORK_ITEM'].includes(node.type)
    const available=moving?.active&&moving.ready&&canvas.targets.some(target=>target.id===node.id)
    return <div className={s.node} key={node.id} role="treeitem" tabIndex={0} aria-expanded={nested.length?true:undefined} aria-label={`${node.type.replaceAll('_',' ')}: ${node.label}`} data-structure-id={node.id} data-drop-state={moving?.active?(available?'available':'unavailable'):undefined}>
      <div className={`${s.card} ${node.type==='PROJECT'?s.rootCard:''}`} data-structure-card="" data-structure-target={node.id}>
        <div className={s.eyebrow}>{node.type.replaceAll('_',' ')}</div>
        {node.type==='WORK_ITEM'?<button className={s.itemTitle} onClick={async()=>{try{const response=await fetch(`/api/work?projectId=${projectId}&q=${encodeURIComponent(node.code)}`);if(!response.ok)throw new Error();const work=(await response.json()).items?.find(row=>row.id===node.id);if(!work)throw new Error();setItem(work)}catch{setError('Work could not be loaded. Reload the Project.')}}}>{node.label}</button>:<div className={s.title}>{node.label}</div>}
        <div className={s.badges}><span className={s.badge}>{node.code}</span>{node.executionMode&&<span className={s.badge}>{MODE_LABELS[node.executionMode]||node.executionMode}</span>}</div>
        <div className={s.actions}>
          {mayAdd&&<button className="btn" disabled={busy||uncertain} aria-label={`Add child to ${node.code}`} data-structure-action={`add:${node.id}`} onClick={event=>beginCreate(node,event.currentTarget)}>+</button>}
          {mayMove&&<><button className="btn" disabled={busy||uncertain} aria-label={`Move ${node.code}`} data-structure-action={`move:${node.id}`} onClick={event=>beginMove(node,event.currentTarget)}>Move to…</button><button className="btn" disabled={busy||uncertain} aria-label={`Drag ${node.code}`} data-structure-action={`drag:${node.id}`} onPointerDown={event=>startDrag(event,node)} style={{touchAction:'none'}}>↗</button></>}
        </div>
      </div>
      {!!nested.length&&<div className={s.branch} role="group">{nested.map(child=><div className={s.leaf} key={child.id}>{renderNode(child)}</div>)}</div>}
    </div>
  }
  return <>
    <div className={s.feedback}>
      <p role="status" aria-live="polite">{busy?'Structure change pending preview or save.':moving?.active?'Only destinations marked Available accept this move.':phase==='saved'?'Structure saved.':''}</p>
      {moving?.active&&<p>{moving.ready?'Available destinations are outlined and labelled.':'Checking destinations…'}</p>}
      {error&&<p role="alert">{error}</p>}
      {phase==='pending'&&<button className="btn" onClick={cancel}>Cancel preview</button>}
      {uncertain&&<button className="btn" onClick={()=>execute(recovery.current)}>Retry structure change</button>}
      {phase==='refused'&&!uncertain&&attempt.current&&<button className="btn" onClick={()=>{if(attempt.current.kind==='move'){const node=canvas.nodes.find(node=>node.id===attempt.current.id);if(node)prepareMove(node)}else setDialog(attempt.current)}}>Correct structure change</button>}
      <button className="btn" disabled={busy} onClick={reload}>Reload Project</button>
      {receipt?.deltaReceipt?.undoable&&<button className="btn" disabled={busy||uncertain} onClick={()=>{attempt.current=null;execute(projectPlan(projectId,[{op:'undo',originalAuditEventId:receipt.auditEventId,expectedAfterHash:receipt.deltaReceipt.afterHash}]))}}>Undo last structure change</button>}
    </div>
    <section className={s.canvas} aria-label="Project Structure Plan"><div role="tree" className={s.tree} aria-label={`${root?.label} work breakdown structure`}>{root&&renderNode(root)}</div></section>
    {dialog&&<StructureDialog key={`${dialog.kind}:${dialog.id||dialog.parentId}`} canvas={canvas} draft={dialog} onCancel={cancel} onSubmit={(plan,draft)=>{attempt.current=draft;execute(plan)}}/>}
    <WorkpackageModal key={item?.id} open={!!item} item={item} onClose={()=>setItem(null)} onSaved={reload}/>
  </>
}
function StructureDialog({canvas,draft,onCancel,onSubmit}){
  const ref=useRef(null),parent=canvas.nodes.find(node=>node.id===draft.parentId)
  const [type,setType]=useState(draft.type||(parent?.type==='PROJECT'?'WORKSTREAM':'WORK_ITEM'))
  const parentStream=(()=>{let node=parent;const seen=new Set();while(node&&node.type!=='WORKSTREAM'){if(seen.has(node.id))return null;seen.add(node.id);node=canvas.nodes.find(row=>row.id===node.parentId)}return node})()
  const binding=catalogue.contracts[parentStream?.executionMode]
  const subtypes=type==='WORK_ITEM'?binding?.itemSubtypes:binding?.containerSubtypes
  useEffect(()=>{const element=ref.current;element.showModal();return()=>element.close()},[])
  return <dialog ref={ref} aria-label={draft.kind==='move'?'Move work':'Add child'} className={s.dialog} onCancel={event=>{event.preventDefault();onCancel()}}>
    <h2>{draft.kind==='move'?'Move work':'Add child'}</h2>
    <form onSubmit={event=>{
      event.preventDefault();const data=new FormData(event.currentTarget)
      if(draft.kind==='move'){onSubmit(moveNodePlan(canvas,draft.id,data.get('destination')),draft);return}
      const fields={code:data.get('code'),[type==='WORKSTREAM'?'name':'title']:data.get('name'),...(type==='WORKSTREAM'?{executionMode:data.get('mode')}:{subtype:data.get('subtype')})}
      onSubmit(createNodePlan(canvas,parent.id,type,fields),{...draft,type,fields})
    }}>
      {draft.kind==='move'?<label>Destination<select aria-label="Destination" name="destination" className="input" required autoFocus defaultValue=""><option value="" disabled>Select destination</option>{canvas.targets.map(target=>{const node=canvas.nodes.find(row=>row.id===target.id);return <option key={target.id} value={target.id}>{node.code} · {node.label}</option>})}</select>{!canvas.targets.length&&<span>No valid destinations for this work.</span>}</label>:<>
        <label>Code<input aria-label="Code" name="code" className="input" required autoFocus maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" defaultValue={draft.fields?.code||''}/></label>
        <label>Name<input aria-label="Name" name="name" className="input" required maxLength={240} defaultValue={draft.fields?.title||draft.fields?.name||''}/></label>
        {parent.type!=='PROJECT'&&<label>Child type<select aria-label="Child type" className="input" value={type} onChange={event=>setType(event.target.value)}><option value="WORK_ITEM">WorkItem</option><option value="WORK_CONTAINER">WorkContainer</option></select></label>}
        {type==='WORKSTREAM'?<label>Execution mode<select aria-label="Execution mode" name="mode" className="input" defaultValue={draft.fields?.executionMode||'SOFTWARE_SPRINT'}>{EXECUTION_MODES.map(mode=><option key={mode} value={mode}>{MODE_LABELS[mode]||mode}</option>)}</select></label>:<label>Subtype<select key={type} aria-label="Subtype" name="subtype" className="input" required defaultValue={draft.fields?.subtype||subtypes?.[0]}>{subtypes?.map(subtype=><option key={subtype}>{subtype}</option>)}</select></label>}
      </>}
      <div className={s.actions}><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="submit" disabled={draft.kind==='move'&&!canvas.targets.length}>{draft.kind==='move'?'Move work':'Create child'}</button></div>
    </form>
  </dialog>
}
