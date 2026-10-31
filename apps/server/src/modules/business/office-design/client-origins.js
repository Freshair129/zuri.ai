// @req FR-295 — limit browser handoff peers to explicitly configured safe origins.
// @tested tests/unit/office-client-origin.test.js
export function officeClientOrigins(value=''){
 return [...new Set(value.split(',').map(s=>s.trim()).filter(value=>{
  try{const u=new URL(value);return value===u.origin&&!u.username&&!u.password&&(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))}catch{return false}
 }))]
}
