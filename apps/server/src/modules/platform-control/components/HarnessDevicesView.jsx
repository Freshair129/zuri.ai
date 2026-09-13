'use client'

// @req FR-220 — the installation operator's list of paired agent harness devices:
// who each one reports as, its label, status and last use, with activate for a
// device a non-operator paired and revoke for any device. No key material is
// ever fetched or shown; the list reads identity's operator-only route.
// @spec ADR-087 D2, D3; NFR-008
// @tested tests/unit/harness-devices-view.test.js

import { useCallback, useEffect, useState } from 'react'
import { Card, StatusPill } from '@/components/ui'
import styles from './program-roadmap-board.module.css'

const HARNESS_NAME = { CLAUDE_CODE: 'Claude Code', CODEX: 'Codex' }
const STATUS_PILL = { ACTIVE: 'DONE', PENDING_ACTIVATION: 'REVIEW', REVOKED: 'BLOCKED' }
const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—')

export default function HarnessDevicesView({ initialDevices = null, fetcher = globalThis.fetch }) {
  const [devices, setDevices] = useState(initialDevices)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const response = await fetcher('/api/platform/harness-devices', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'โหลดรายการเครื่องไม่สำเร็จ')
      setDevices(body.devices || [])
      setError('')
    } catch (failure) {
      setError(failure.message)
      setDevices((prior) => prior ?? [])
    }
  }, [fetcher])

  useEffect(() => {
    if (initialDevices === null) load()
  }, [initialDevices, load])

  async function decide(device, action) {
    setBusyId(device.id)
    setError('')
    try {
      const reason = action === 'revoke' ? 'Revoked from /control/roadmap' : undefined
      const response = await fetcher(`/api/platform/harness-devices/${device.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, version: device.version, reason }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || (action === 'revoke' ? 'เพิกถอนไม่สำเร็จ' : 'เปิดใช้งานไม่สำเร็จ'))
      await load()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card data-testid="harness-devices-view">
      <h2 className="text-base font-bold">Agent devices</h2>
      <p className="mb-3 text-xs text-muted">
        เครื่องที่จับคู่ plugin ของ Zuri ไว้ แต่ละเครื่องส่งยอด token ในนามคนที่อนุมัติใน browser และทำได้แค่ส่งยอด
        · เครื่องที่คนที่ไม่ใช่ operator จับคู่ต้องเปิดใช้งานก่อน · เพิกถอนแล้วมีผลที่การส่งครั้งถัดไป
      </p>
      {error && <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">{error}</p>}
      {devices === null ? (
        <p role="status" className="text-xs text-muted">กำลังโหลด…</p>
      ) : devices.length === 0 ? (
        <p className="text-xs text-muted" data-testid="harness-devices-empty">ยังไม่มีเครื่องที่จับคู่ — ติดตั้ง plugin zuri-harness แล้วสั่ง pair จาก Claude Code หรือ Codex</p>
      ) : (
        <div className={styles.tableFrame}>
          <table className={styles.devicesTable}>
            <caption className="sr-only">Paired agent harness devices</caption>
            <thead>
              <tr><th>Device</th><th>Person</th><th>Harness</th><th>Status</th><th>Paired</th><th>Last report</th><th>Key</th><th /></tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id} data-testid={`harness-device-${device.installationId}`}>
                  <td><b>{device.deviceLabel}</b>{device.osUser ? <span className="text-muted"> · {device.osUser}</span> : null}</td>
                  <td>{device.personDisplayName || '—'}</td>
                  <td>{HARNESS_NAME[device.harness] || device.harness}</td>
                  <td><StatusPill status={STATUS_PILL[device.status] || device.status} /> <span className="text-[11px] text-muted">{device.status}</span></td>
                  <td>{when(device.createdAt)}</td>
                  <td>{when(device.lastUsedAt)}</td>
                  <td><code className="text-[11px]">{device.keyPrefix}…</code></td>
                  <td className="whitespace-nowrap text-right">
                    {device.status === 'PENDING_ACTIVATION' && (
                      <button type="button" className={styles.deviceAction} disabled={busyId === device.id} onClick={() => decide(device, 'activate')}>เปิดใช้งาน</button>
                    )}
                    {device.status !== 'REVOKED' && (
                      <button type="button" className={`${styles.deviceAction} ${styles.deviceRevoke}`} disabled={busyId === device.id} onClick={() => decide(device, 'revoke')}>เพิกถอน</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
