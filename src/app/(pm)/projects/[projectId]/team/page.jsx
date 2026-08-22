'use client'

// @req FR-036 — team manager exposes scoped memberships and active assignee load.
// @spec SDD-015, BR-001, SEC-003, docs/features/FR-036-project-team.md
// @tested tests/unit/project-team-service.test.js
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { UserMinus, UserPlus } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

function MemberRow({ member, onRoleChange, onRemove }) {
  return (
    <div className="flex items-center gap-3 border-t border-[var(--border)] py-3 first:border-t-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-tint)] text-xs font-bold text-[var(--brand-dark)]" aria-hidden>
        {member.person.displayName.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold">{member.person.displayName}</p>
        <p className="truncate text-[10px] text-muted">{member.person.code}{member.person.email ? ` · ${member.person.email}` : ''}</p>
      </div>
      <span className="hidden text-[11px] text-muted sm:block">{member.activeWorkItems} active items</span>
      {member.mutable ? (
        <>
          <select
            className="input w-auto py-1 text-[11px]"
            value={member.role}
            aria-label={`Role for ${member.person.displayName}`}
            onChange={(event) => onRoleChange(member.id, event.target.value)}
          >
            <option value="OWNER">Owner</option>
            <option value="MEMBER">Member</option>
          </select>
          <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => onRemove(member.id)} aria-label={`Remove ${member.person.displayName}`}>
            <UserMinus size={14} aria-hidden />
          </button>
        </>
      ) : (
        <StatusPill status={member.role} />
      )}
    </div>
  )
}

export default function ProjectTeamPage() {
  const { projectId } = useParams()
  const project = useFetch(`/api/projects/${projectId}`)
  const team = useFetch(`/api/projects/${projectId}/team`)
  const [personId, setPersonId] = useState('')
  const [role, setRole] = useState('MEMBER')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (project.loading || team.loading) return <LoadingCard />
  if (project.error) return <ErrorState detail={project.error} retry={project.reload} />
  if (team.error) return <ErrorState detail={team.error} retry={team.reload} />

  const refresh = () => {
    project.reload()
    team.reload()
  }
  const mutate = async (request) => {
    setBusy(true)
    setError(null)
    try {
      await request()
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const data = team.data
  const mutable = Boolean(data.businessId ?? data.workspace?.businessId)

  return (
    <div>
      <PageHeader
        eyebrow={project.data?.code || 'Project'}
        title="Team"
        subtitle={mutable ? 'People with access to this business and their active assigned work.' : 'Group project memberships are tenant-wide and read-only here.'}
      />
      {error && <ErrorState detail={error} retry={() => setError(null)} />}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <SectionTitle caption="Memberships in this project’s business scope">Members</SectionTitle>
          {data.members.length === 0 ? (
            <EmptyState title="No team members in scope" hint="Add an existing person to the business team." />
          ) : (
            data.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                onRoleChange={(membershipId, nextRole) => mutate(() => api(`/api/projects/${projectId}/team`, { method: 'PATCH', body: { membershipId, role: nextRole } }))}
                onRemove={(membershipId) => mutate(() => api(`/api/projects/${projectId}/team`, { method: 'DELETE', body: { membershipId } }))}
              />
            ))
          )}
        </Card>
        <Card>
          <SectionTitle caption={mutable ? 'Adds a business-scoped Membership and records an audit event' : 'A project-specific member model is required before this scope can mutate'}>
            Add team member
          </SectionTitle>
          {mutable ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                mutate(async () => {
                  await api(`/api/projects/${projectId}/team`, { method: 'POST', body: { personId, role } })
                  setPersonId('')
                  setRole('MEMBER')
                })
              }}
            >
              <select className="input" value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label="Person to add">
                <option value="">Choose a person</option>
                {data.availablePeople.map((person) => <option key={person.id} value={person.id}>{person.displayName} · {person.code}</option>)}
              </select>
              <select className="input" value={role} onChange={(event) => setRole(event.target.value)} aria-label="Role">
                <option value="OWNER">Owner</option>
                <option value="MEMBER">Member</option>
              </select>
              <button type="submit" className="btn btn-primary flex items-center gap-1" disabled={busy || !personId}>
                <UserPlus size={14} aria-hidden /> Add member
              </button>
            </form>
          ) : (
            <p className="text-xs text-muted">This avoids changing a tenant-wide entitlement from one project screen.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
