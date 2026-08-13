'use client'

// @req FR-038 — local profile shows the resolved account, language preference, identity link, and session boundary.
// @spec SDD-017, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import { useEffect, useState } from 'react'
import { Link2, Monitor } from 'lucide-react'
import { Card, ErrorState, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

const LANGUAGE_KEY = 'zuri-v2-language'

export default function ProfilePage() {
  const profile = useFetch('/api/profile')
  const [language, setLanguage] = useState('TH')
  useEffect(() => {
    try { setLanguage(localStorage.getItem(LANGUAGE_KEY) || 'TH') } catch {}
  }, [])
  const changeLanguage = (next) => {
    setLanguage(next)
    try { localStorage.setItem(LANGUAGE_KEY, next) } catch {}
  }
  if (profile.loading) return <LoadingCard />
  if (profile.error) return <ErrorState title="Unable to load profile" detail={profile.error} retry={profile.reload} />
  const data = profile.data
  const initials = data.principal.displayName.slice(0, 1).toUpperCase()

  return (
    <div>
      <PageHeader eyebrow="Account" title="My profile" subtitle="Local MVP account state. Production authentication and session management are a later identity slice." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle caption="Resolved from the viewer gate">Account</SectionTitle>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-tint)] text-lg font-bold text-[var(--brand-dark)]" aria-hidden>{initials}</span>
            <div><p className="text-sm font-bold">{data.principal.displayName}</p><p className="text-xs text-muted">{data.principal.code}</p></div>
            <StatusPill status={data.role} />
          </div>
        </Card>
        <Card>
          <SectionTitle caption="Stored only in this browser for the local MVP">Language</SectionTitle>
          <div className="flex gap-2"><button type="button" className={`btn ${language === 'TH' ? 'btn-primary' : ''}`} onClick={() => changeLanguage('TH')}>ไทย</button><button type="button" className={`btn ${language === 'EN' ? 'btn-primary' : ''}`} onClick={() => changeLanguage('EN')}>English</button></div>
        </Card>
        <Card>
          <SectionTitle caption="External identity links, not a separate employee account">LINE link</SectionTitle>
          <div className="flex items-center gap-2 text-xs"><Link2 size={16} aria-hidden /> {data.identities.some((identity) => identity.provider === 'LINE') ? 'LINE linked' : 'No LINE identity linked'}</div>
        </Card>
        <Card>
          <SectionTitle caption="No server session store exists in the offline MVP">Sessions</SectionTitle>
          <div className="flex items-center gap-2 text-xs"><Monitor size={16} aria-hidden /> This device · {data.session.active ? 'active local demo session' : 'inactive'}</div>
        </Card>
      </div>
    </div>
  )
}
