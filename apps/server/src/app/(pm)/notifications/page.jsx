'use client'

// @req FR-026, TASK-ZAI-011 — inbox for recipient-scoped Agent approval outcomes.
import { useState } from 'react'
import { Bell, Check, Clock3 } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader, StatusPill } from '@/components/ui'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

function notificationMessage(notification) {
  const request = `Approval request ${notification.approvalRequestId.slice(0, 8)}`
  const outcome = `${notification.decision.toLowerCase()} · ${notification.approvalStatus.toLowerCase()}`
  if (notification.notificationType === 'OWNER_NEXT_ACTION') {
    if (notification.currentRequestStatus === 'RESTORE_INVALIDATED') {
      return `${request} was invalidated during restore. The recorded vote is preserved; no further vote is needed.`
    }
    if (!notification.actionable) {
      return `${request} is no longer open. No further vote is needed (current status: ${notification.currentRequestStatus || 'unavailable'}).`
    }
    return `Your vote is needed. ${request} has ${outcome}.`
  }
  if (notification.notificationType === 'OWNER_OUTCOME') return `${request} has a final outcome: ${outcome}.`
  return `A Business Owner voted on your request: ${outcome}.`
}

export default function ApprovalNotificationsPage() {
  const { data, loading, error, reload } = useFetch('/api/agent/approval-notifications')
  const [markingId, setMarkingId] = useState(null)
  const [actionError, setActionError] = useState(null)

  async function markRead(id) {
    setMarkingId(id)
    setActionError(null)
    try {
      const csrf = await api('/api/auth/csrf')
      await api(`/api/agent/approval-notifications/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf.token },
      })
      await reload()
    } catch (cause) {
      setActionError(cause.message || 'Unable to mark notification as read.')
    } finally {
      setMarkingId(null)
    }
  }

  if (loading) return <LoadingCard />
  if (error) return <ErrorState title="Unable to load notifications" detail={error} retry={reload} />

  const notifications = data?.notifications || []
  return (
    <div>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        subtitle="Approval decisions and the next vote needed in your Businesses."
        actions={<span className="pill pill-planned">{data?.unreadCount || 0} unread</span>}
      />
      {actionError && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700" role="alert">{actionError}</p>}
      {!notifications.length ? (
        <EmptyState title="No notifications" hint="Approval updates for your account will appear here." />
      ) : (
        <div className="grid gap-3">
          {notifications.map((notification) => (
            <Card key={notification.id} className={notification.readAt ? 'opacity-75' : 'border-[var(--brand)]'}>
              <div className="flex items-start justify-between gap-4 max-sm:flex-col">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${notification.readAt ? 'bg-black/5 text-muted' : 'bg-[var(--brand-tint)] text-[var(--brand-dark)]'}`} aria-hidden>
                    {notification.readAt ? <Check size={17} /> : <Bell size={17} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{notificationMessage(notification)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill status={notification.currentRequestStatus || notification.approvalStatus} />
                      <span className="text-[11px] text-muted">Notice recorded: {notification.approvalStatus.toLowerCase()}</span>
                      <span className="text-[11px] text-muted">Business {notification.businessId.slice(0, 8)}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Clock3 size={12} aria-hidden /> {new Date(notification.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {notification.readAt ? (
                  <span className="shrink-0 text-xs text-muted">Read</span>
                ) : (
                  <button
                    type="button"
                    className="btn shrink-0"
                    onClick={() => markRead(notification.id)}
                    disabled={markingId === notification.id}
                    aria-label={`Mark notification for approval request ${notification.approvalRequestId.slice(0, 8)} as read`}
                  >
                    {markingId === notification.id ? 'Saving…' : 'Mark as read'}
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {notifications.length >= 100 && <p className="mt-3 text-xs text-muted">Showing the 100 most recent notifications.</p>}
    </div>
  )
}
