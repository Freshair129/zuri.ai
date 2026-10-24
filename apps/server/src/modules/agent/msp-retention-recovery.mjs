import { createPublicKey, verify } from 'node:crypto'
// @req FR-230 — only the guarded host can attest a stopped-container recovery.
// @spec SEC-001, SEC-031
// @tested tests/unit/msp-retention.test.js, tests/integration/msp-retention-fence.test.js
export function verifyMspRetentionRecoveryProof({ proof, env, runId, stoppedContainerId, currentHost, now = Date.now() }) {
  const key = env.ZURI_MSP_RETENTION_RECOVERY_PUBLIC_KEY, c = proof?.claims
  const deny = () => { throw new Error('MSP_RETENTION_RECOVERY_PROOF_INVALID') }
  if (typeof key !== 'string' || !c || typeof proof.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(proof.signature)) deny()
  try {
    const pem = Buffer.from(key, 'base64').toString('utf8')
    if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) deny()
    const publicKey = createPublicKey(pem)
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(JSON.stringify(c)), publicKey, Buffer.from(proof.signature, 'base64url'))) deny()
  } catch { deny() }
  if (Object.keys(c).sort().join(',') !== 'appRevision,currentContainerId,expiresAt,issuedAt,nonce,project,runId,stoppedContainerId'
    || c.runId !== runId || c.stoppedContainerId !== stoppedContainerId
    || !/^[0-9a-f]{64}$/.test(c.currentContainerId) || !c.currentContainerId.startsWith(currentHost)
    || c.project !== env.ZURI_MSP_RETENTION_PROJECT || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(c.project)
    || c.appRevision !== env.ZURI_MSP_RETENTION_APP_REVISION || !/^[0-9a-f]{40}$/.test(c.appRevision)
    || !/^[0-9a-f-]{36}$/.test(c.nonce) || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt)
    || c.issuedAt > now + 5000 || c.issuedAt < now - 60000 || c.expiresAt <= now
    || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 60000) deny()
  return c
}
