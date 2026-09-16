import { Building2, LayoutGrid } from 'lucide-react'

// @req FR-039 — Base Context Bar maps schema identity to user-facing labels.
// @spec SDD-018, ADR-011, ADR-076 — IDs and tenant isolation are unchanged.
// @tested tests/unit/scope-view-context.test.js
export const BASE_CONTEXT_LEVELS = [
  { schema: 'portfolio', label: 'Group', fallback: 'Select group' },
  { schema: 'tenant', label: 'Organization', fallback: 'Select organization' },
  { schema: 'business', label: 'Business', fallback: 'Select business' },
]

// Two lenses over the SAME scope entities (Portfolio → Business → Workspace → Project) —
// no schema change, just relabelling + re-anchoring the switcher. This mirrors Dynamics 365's
// "organization hierarchy purpose": one set of org units, several hierarchies over it.
//
//   ERP lens  — anchors on the company/legal-entity (SAP Company Code, NetSuite Subsidiary).
//               Business is the primary switcher; the Group (Portfolio) exists only to
//               consolidate ("รวมงบทุกบริษัท"). schema-Workspace reads as an operating unit.
//   PM lens   — anchors on the top group. Portfolio IS the "Group"
//               container at the top; Business is a business unit; schema-Workspace is a "Workspace".
//
// `levels` are ordered top→down. `hero` marks the primary (Slack-style) switcher; the rest
// render as compact selects. `schema` is the real entity each label maps to, so the same
// selection state drives both lenses.
export const SCOPE_VIEWS = {
  erp: {
    key: 'erp',
    label: 'ERP',
    icon: Building2,
    allLabel: 'รวมงบทุกบริษัท',
    addLabel: 'เพิ่มบริษัท',
    levels: [
      { schema: 'portfolio', label: 'กลุ่มบริษัท', placeholder: 'ทุกบริษัท (รวมงบ)' },
      { schema: 'business', label: 'บริษัท', placeholder: 'เลือกบริษัท', hero: true, legal: true },
      { schema: 'workspace', label: 'พื้นที่ทำงาน', placeholder: 'ทุกพื้นที่ทำงาน' },
      { schema: 'project', label: 'โปรเจกต์', placeholder: 'เลือกโปรเจกต์' },
    ],
  },
  pm: {
    key: 'pm',
    label: 'PM',
    icon: LayoutGrid,
    allLabel: 'ทุกธุรกิจ',
    addLabel: 'เพิ่มธุรกิจ',
    levels: [
      { schema: 'portfolio', label: 'Group', placeholder: 'All groups', hero: true },
      { schema: 'business', label: 'Business', placeholder: 'All businesses' },
      { schema: 'workspace', label: 'Workspace', placeholder: 'All workspaces' },
      { schema: 'project', label: 'Project', placeholder: 'Select project' },
    ],
  },
}

export const DEFAULT_VIEW = 'erp' // Zuri is ERP-shaped (books, tax, branches); PM is the alt lens.

export function resolveView(mode) {
  return SCOPE_VIEWS[mode] || SCOPE_VIEWS[DEFAULT_VIEW]
}
