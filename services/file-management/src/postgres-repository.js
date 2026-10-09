// @spec ADR-107 - durable operation, version, audit and outbox transactions.
// @tested tests/postgres-repository.test.js
const FILE_COLUMNS = `f.id, f.tenant_id, f.business_id, f.status, f.current_version_id,
  f.created_by, f.row_version, f.created_at, f.updated_at, f.deleted_at`

function fileRow(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    businessId: row.business_id,
    status: row.status,
    currentVersionId: row.current_version_id,
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    currentVersion: row.version_id ? versionRow(row) : null,
  }
}

function versionRow(row) {
  if (!row) return null
  return {
    id: row.version_id || row.id,
    fileId: row.file_id,
    versionNumber: row.version_number,
    fileName: row.file_name,
    contentType: row.declared_content_type,
    detectedContentType: row.detected_content_type,
    safetyState: row.safety_state,
    byteLength: Number(row.byte_length),
    sha256: row.sha256,
    storageProvider: row.storage_provider,
    storageBindingId: row.storage_binding_id,
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    storageVersionId: row.storage_version_id,
    provenance: row.provenance_json,
    createdBy: row.version_created_by ?? row.created_by,
    createdAt: row.created_at,
  }
}

function operationRow(row) {
  return {
    operationId: row.id,
    correlationId: row.correlation_id,
    fileId: row.file_id,
    versionId: row.version_id,
    tenantId: row.tenant_id,
    businessId: row.business_id,
    actorId: row.actor_id,
    operationType: row.operation_type,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_sha256,
    status: row.status,
    result: row.result_json,
    storageProvider: row.storage_provider,
    storageBindingId: row.storage_binding_id,
    storageBucket: row.storage_bucket,
  }
}

export function createPostgresFileRepository(pool) {
  async function transaction(run) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    } finally {
      client.release()
    }
  }

  async function getFile(id) {
    const result = await pool.query(`SELECT ${FILE_COLUMNS}, v.id AS version_id, v.version_number,
      v.file_id, v.file_name, v.declared_content_type, v.detected_content_type, v.safety_state, v.byte_length, v.sha256, v.storage_provider, v.storage_binding_id, v.storage_bucket, v.storage_key, v.storage_version_id,
      v.provenance_json, v.created_at AS version_created_at, v.created_by AS version_created_by
      FROM zuri_files.file_record f
      LEFT JOIN zuri_files.file_version v ON v.id = f.current_version_id
      WHERE f.id = $1`, [id])
    const row = result.rows[0]
    if (!row) return null
    const resultFile = fileRow(row)
    if (resultFile.currentVersion) resultFile.currentVersion.createdAt = row.version_created_at
    return resultFile
  }

  async function listFiles({ tenantId, businessId, limit, cursor, query }) {
    const result = await pool.query(`SELECT ${FILE_COLUMNS}, v.file_id, v.id AS version_id, v.version_number,
      v.file_name, v.declared_content_type, v.detected_content_type, v.safety_state, v.byte_length, v.sha256,
      v.storage_provider, v.storage_binding_id, v.storage_bucket, v.storage_key, v.storage_version_id,
      v.provenance_json, v.created_at AS version_created_at, v.created_by AS version_created_by
      FROM zuri_files.file_record f
      JOIN zuri_files.file_version v ON v.id = f.current_version_id
      WHERE f.tenant_id=$1 AND f.business_id=$2 AND f.status='ACTIVE' AND f.deleted_at IS NULL
        AND ($3::text IS NULL OR strpos(lower(v.file_name), lower($3)) > 0)
        AND ($4::timestamptz IS NULL OR (f.updated_at, f.id) < ($4::timestamptz, $5::uuid))
      ORDER BY f.updated_at DESC, f.id DESC LIMIT $6`,
    [tenantId, businessId, query, cursor?.updatedAt ?? null, cursor?.id ?? null, limit])
    return result.rows.map((row) => {
      const file = fileRow(row)
      if (file.currentVersion) file.currentVersion.createdAt = row.version_created_at
      return file
    })
  }

  return Object.freeze({
    async health() {
      const result = await pool.query('SELECT 1 AS ready')
      return result.rows[0]?.ready === 1
    },
    async beginOperation(input) {
      return transaction(async (client) => {
        const insert = await client.query(`INSERT INTO zuri_files.file_operation
          (id, correlation_id, file_id, version_id, tenant_id, business_id, actor_id, operation_type,
           idempotency_key, request_sha256, storage_provider, storage_binding_id, storage_bucket, file_name, declared_content_type, byte_length, sha256,
           provenance_json, status, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'PENDING',$19)
          ON CONFLICT (tenant_id, business_id, actor_id, operation_type, idempotency_key) DO NOTHING
          RETURNING *`, [input.operationId, input.correlationId, input.fileId, input.versionId, input.tenantId, input.businessId,
          input.actorId, input.operationType, input.idempotencyKey, input.requestDigest, input.storageProvider,
          input.storageBindingId, input.storageBucket, input.fileName, input.contentType, input.byteLength, input.sha256, input.provenance, input.createdAt])
        if (insert.rows[0]) return operationRow(insert.rows[0])
        const existing = await client.query(`SELECT * FROM zuri_files.file_operation
          WHERE tenant_id=$1 AND business_id=$2 AND actor_id=$3 AND operation_type=$4 AND idempotency_key=$5
          FOR UPDATE`, [input.tenantId, input.businessId, input.actorId, input.operationType, input.idempotencyKey])
        if (!existing.rows[0]) throw new Error('idempotent operation disappeared')
        const row = operationRow(existing.rows[0])
        if (row.requestDigest !== input.requestDigest) return row
        return row
      })
    },
    async commitOperation({ operation, stored, now }) {
      return transaction(async (client) => {
        const locked = await client.query('SELECT * FROM zuri_files.file_operation WHERE id=$1 FOR UPDATE', [operation.operationId])
        if (!locked.rows[0]) throw new Error('operation not found')
        const current = operationRow(locked.rows[0])
        if (current.status === 'COMMITTED') return current.result
        if (current.status !== 'PENDING') throw new Error('operation cannot be committed from its current state')

        if (current.operationType === 'CREATE') {
          await client.query(`INSERT INTO zuri_files.file_record
            (id, tenant_id, business_id, status, created_by, created_at, updated_at)
            VALUES ($1,$2,$3,'ACTIVE',$4,$5,$5)
            ON CONFLICT (id) DO NOTHING`, [current.fileId, current.tenantId, current.businessId, current.actorId, now])
        }
        const file = await client.query(`SELECT id, tenant_id, business_id, status, deleted_at
          FROM zuri_files.file_record WHERE id=$1 FOR UPDATE`, [current.fileId])
        const fileRowLocked = file.rows[0]
        if (!fileRowLocked || fileRowLocked.tenant_id !== current.tenantId || fileRowLocked.business_id !== current.businessId || fileRowLocked.deleted_at || fileRowLocked.status !== 'ACTIVE') {
          throw new Error('file scope changed before version commit')
        }
        const number = await client.query('SELECT COALESCE(MAX(version_number),0)+1 AS next_number FROM zuri_files.file_version WHERE file_id=$1', [current.fileId])
        await client.query(`INSERT INTO zuri_files.file_version
          (id, file_id, version_number, file_name, declared_content_type, safety_state, byte_length, sha256,
           storage_provider, storage_binding_id, storage_bucket, storage_key, storage_version_id, provenance_json, created_by, created_at)
          VALUES ($1,$2,$3,$4,$5,'UNSCANNED',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [current.versionId, current.fileId,
          number.rows[0].next_number, locked.rows[0].file_name, locked.rows[0].declared_content_type,
          locked.rows[0].byte_length, locked.rows[0].sha256, stored.provider, stored.bindingId, stored.bucket, stored.key, stored.versionId,
          locked.rows[0].provenance_json, current.actorId, now])
        await client.query('UPDATE zuri_files.file_record SET current_version_id=$2, updated_at=$3, row_version=row_version+1 WHERE id=$1', [current.fileId, current.versionId, now])
        await client.query(`INSERT INTO zuri_files.file_audit_event
          (id, file_id, operation_id, tenant_id, business_id, actor_id, event_type, event_json, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,'FILE_VERSION_STORED',$7::jsonb,$8)`, [current.operationId, current.fileId,
          current.operationId, current.tenantId, current.businessId, current.actorId,
          JSON.stringify({ correlationId: current.correlationId, versionId: current.versionId, versionNumber: Number(number.rows[0].next_number), sha256: locked.rows[0].sha256, byteLength: Number(locked.rows[0].byte_length) }), now])
        await client.query(`INSERT INTO zuri_files.file_outbox_event
          (id, operation_id, tenant_id, business_id, file_id, version_id, event_type, payload_json, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,'FILE_VERSION_READY',$7::jsonb,$8)`, [current.operationId, current.operationId,
          current.tenantId, current.businessId, current.fileId, current.versionId,
          JSON.stringify({ correlationId: current.correlationId, fileId: current.fileId, versionId: current.versionId, versionNumber: Number(number.rows[0].next_number), sha256: locked.rows[0].sha256, byteLength: Number(locked.rows[0].byte_length), safetyState: 'UNSCANNED' }), now])
        const result = {
          fileId: current.fileId,
          versionId: current.versionId,
          versionNumber: Number(number.rows[0].next_number),
          operationId: current.operationId,
          correlationId: current.correlationId,
          status: 'STORED',
          sha256: locked.rows[0].sha256,
        byteLength: Number(locked.rows[0].byte_length),
        safetyState: 'UNSCANNED',
          storageVersionId: stored.versionId,
        }
        await client.query(`UPDATE zuri_files.file_operation SET status='COMMITTED', result_json=$2::jsonb, completed_at=$3 WHERE id=$1`, [current.operationId, JSON.stringify(result), now])
        return result
      })
    },
    getFile,
    listFiles,
    async getOperation({ tenantId, businessId, actorId, idempotencyKey }) {
      const result = await pool.query(`SELECT id, file_id, status, result_json, safe_error_code, created_at, completed_at
        FROM zuri_files.file_operation WHERE tenant_id=$1 AND business_id=$2 AND actor_id=$3 AND idempotency_key=$4
        ORDER BY created_at DESC LIMIT 1`, [tenantId, businessId, actorId, idempotencyKey])
      const row = result.rows[0]
      return row ? { operationId: row.id, fileId: row.file_id, status: row.status, result: row.result_json, safeErrorCode: row.safe_error_code, createdAt: row.created_at, completedAt: row.completed_at } : null
    },
    async listVersions(fileId) {
      const result = await pool.query(`SELECT id AS version_id, file_id, version_number, file_name, declared_content_type,
        detected_content_type, safety_state, byte_length, sha256, storage_provider, storage_binding_id, storage_bucket, storage_key, storage_version_id, provenance_json, created_by, created_at
        FROM zuri_files.file_version WHERE file_id=$1 ORDER BY version_number DESC`, [fileId])
      return result.rows.map(versionRow)
    },
    async getVersion(fileId, versionId) {
      const result = await pool.query(`SELECT id AS version_id, file_id, version_number, file_name, declared_content_type,
        detected_content_type, safety_state, byte_length, sha256, storage_provider, storage_binding_id, storage_bucket, storage_key, storage_version_id, provenance_json, created_by, created_at
        FROM zuri_files.file_version WHERE file_id=$1 AND id=$2`, [fileId, versionId])
      return versionRow(result.rows[0])
    },
    async close() { await pool.end() },
  })
}
