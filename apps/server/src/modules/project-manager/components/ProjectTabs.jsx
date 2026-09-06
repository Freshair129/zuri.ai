'use client'

// @req FR-040 — Project Work owns Structure Plan, Board, Schedule, and Dependency Map.
// @req FR-012, FR-018 — Project Plan Import is a Project resource surface of its
// own (INTERFACE-INVENTORY §3.5, "ProjectResourceShell → Import"), so it gets a
// tab here rather than hiding under Work. Nothing in the application linked to
// `/projects/{id}/import`: the whole paste/Excel/form intake path was reachable
// only by typing the URL, and only the e2e suite ever did.
// @spec SDD-019, ADR-012, BR-009
// @spec NFR-008 — three of the nine slots were sections with no page behind
// them, interleaved between the six that exist, so the real destinations were
// pushed apart in a row already wide enough to need scrolling. They were also
// greyed `<span>`s whose only explanation was a hover tooltip: a `title`
// attribute is not an accessible name, never reaches a touch user, and reduced
// opacity is not disabled semantics — so the one question the slot provoked
// ("why does this not do anything?") had no answer outside a mouse hover. They
// are now one disclosure at the end of the row, holding genuinely `disabled`
// controls with the reason written on screen.
// @tested tests/unit/project-work-route.test.js
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
// Requirements deliberately does not use Flag: that icon means Milestones &
// Gates everywhere else in the nav (sidebar and Work sub-views), just as
// Network means Dependencies and nothing else.
import {
  CircleDot,
  ChartPie,
  ChevronDown,
  ClipboardList,
  FileText,
  Folder,
  ListTree,
  TriangleAlert,
  Upload,
  Users,
} from 'lucide-react'

// Indest-style per-project domain tab bar. The primary row is destinations that
// exist and nothing else.
const TABS = [
  { key: 'project', label: 'Project', icon: CircleDot, href: (id) => `/projects/${id}` },
  { key: 'inventory', label: 'Inventory', icon: ClipboardList, href: (id) => `/projects/${id}/inventory` },
  { key: 'team', label: 'Team', icon: Users, href: (id) => `/projects/${id}/team` },
  { key: 'work', label: 'Work', icon: ListTree, href: (id) => `/projects/${id}/structure` },
  { key: 'files', label: 'Files', icon: Folder, href: (id) => `/projects/${id}/files` },
  { key: 'import', label: 'Import', icon: Upload, href: (id) => `/projects/${id}/import` },
]

// Disclosed, not deleted. These three are the rest of the Project's shape, and
// the reason they were ever rendered is that a user who cannot see them cannot
// see where the product is going — the sections land one by one, and the bar is
// how that is announced. Deleting them would reclaim the space by hiding the
// roadmap; putting them behind the disclosure reclaims the same space and keeps
// it. They stay in this file, in their intended order, so landing one is moving
// a row up into TABS and giving it an `href`.
const PLANNED = [
  { key: 'requirements', label: 'Requirements', icon: FileText },
  { key: 'risks', label: 'Risks', icon: TriangleAlert },
  { key: 'resources', label: 'Resources', icon: ChartPie },
]

export default function ProjectTabs({ projectId, active }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = useId()
  const noteId = `${panelId}-note`

  // The project layout owns `active` and may one day name a section that is
  // still in PLANNED (it computes the key from the URL, not from this list). If
  // it does, the disclosure has to carry the current marker, or the contract
  // silently stops holding for exactly the tabs that moved.
  const activeIsPlanned = PLANNED.some((tab) => tab.key === active)

  useEffect(() => {
    if (!open) return undefined
    // The panel holds only disabled controls, so nothing inside it is in the
    // tab order; focusing the panel itself is what puts a keyboard or screen
    // reader user on the content they just asked for.
    panelRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }

    // `pointerdown`, not `click`: closing on the press means the same press
    // cannot also activate whatever the panel was covering.
    function handlePointerDown(event) {
      if (wrapperRef.current?.contains(event.target)) return
      setOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [open])

  const tabCls = (isActive) =>
    `flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
      isActive ? 'bg-[#eaf0ff] text-[#2f4fe0]' : 'text-[var(--muted)] hover:bg-[var(--surface-mid)] hover:text-[var(--text)]'
    }`

  return (
    <nav
      aria-label="Project sections"
      className="mb-4 flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-1.5"
    >
      {/* Only the live tabs scroll. `overflow-x-auto` establishes a clipping
          context, so an absolutely positioned panel inside it would be cut off;
          keeping the trigger outside the scroller also means "More" stays put
          instead of sliding away with the row. */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          const isActive = t.key === active
          return (
            <Link
              key={t.key}
              href={t.href(projectId)}
              className={tabCls(isActive)}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={15} aria-hidden /> {t.label}
            </Link>
          )
        })}
      </div>

      <div ref={wrapperRef} className="relative shrink-0">
        <button
          ref={triggerRef}
          type="button"
          className={`${tabCls(activeIsPlanned)} ${open && !activeIsPlanned ? 'bg-[var(--surface-mid)] text-[var(--text)]' : ''}`}
          aria-expanded={open}
          aria-controls={panelId}
          aria-current={activeIsPlanned ? 'true' : undefined}
          aria-label={`More — ${PLANNED.length} project sections not built yet`}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          More
          <ChevronDown size={15} aria-hidden className={`transition ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div
            id={panelId}
            ref={panelRef}
            tabIndex={-1}
            role="group"
            aria-label="Project sections not built yet"
            className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-1.5 shadow-lg outline-none"
          >
            {/* The explanation the `title` attribute used to hold, said out
                loud: on screen, in the accessible tree, and on touch. */}
            <p id={noteId} className="px-2 pb-1 pt-1.5 text-[11px] leading-4 text-[var(--muted)]">
              Planned sections of this Project. They have no page yet, so nothing here opens.
            </p>
            <ul>
              {PLANNED.map((t) => {
                const Icon = t.icon
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      aria-describedby={noteId}
                      aria-current={t.key === active ? 'true' : undefined}
                      className="flex w-full cursor-default items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[var(--muted)] opacity-60"
                    >
                      <Icon size={15} aria-hidden /> {t.label}
                      <span className="ml-auto rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                        Soon
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </nav>
  )
}
