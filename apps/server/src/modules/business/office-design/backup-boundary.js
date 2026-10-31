// @req FR-294 — legacy JSON snapshots cannot silently discard the new registry.
// @tested tests/unit/office-design-backup.test.js
export async function assertOfficeDesignBackupSafe(db,snapshot){
 if(snapshot?.tables&&Object.keys(snapshot.tables).some(k=>/^officeDesign/i.test(k)))throw Object.assign(new Error('OFFICE_DESIGN_RECOVERY_UNAVAILABLE'),{code:'OFFICE_DESIGN_RECOVERY_UNAVAILABLE',status:409})
 // Existing dependency-injected legacy snapshot ports predate this schema. A real
 // application client always exposes this delegate; missing production visibility fails closed.
 if(typeof db?.officeDesignRegistry?.count!=='function'){
  if(db?._runtimeDataModel||db?._activeProvider)throw Object.assign(new Error('OFFICE_DESIGN_RECOVERY_UNAVAILABLE'),{code:'OFFICE_DESIGN_RECOVERY_UNAVAILABLE',status:409})
  return
 }
 if(await db.officeDesignRegistry.count()>0)throw Object.assign(new Error('OFFICE_DESIGN_RECOVERY_UNAVAILABLE'),{code:'OFFICE_DESIGN_RECOVERY_UNAVAILABLE',status:409})
}
