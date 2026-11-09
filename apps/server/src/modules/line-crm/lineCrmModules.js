import {
  Bot,
  Grid,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Star,
  Users,
  Zap,
} from 'lucide-react'

// @req FR-091 — central availability and presentation registry for LINE CRM surfaces.
// @spec SDD-050, ADR-061
// @tested tests/unit/line-crm-module-availability.test.js
export const LINE_CRM_MODULES = [
  {
    id: 'dashboard',
    label: 'แดชบอร์ด',
    title: 'แดชบอร์ด',
    subtitle: 'ภาพรวมการสนทนาและสมาชิก',
    icon: LayoutDashboard,
    color: 'bg-orange-500/10 text-orange-600 border-orange-200',
    available: false,
  },
  {
    id: 'chat',
    label: 'แชทสด',
    title: 'แชทสด / Live Chat',
    subtitle: 'กล่องข้อความสนทนาจาก LINE OA',
    icon: MessageSquare,
    color: 'bg-purple-500/10 text-purple-600 border-purple-200',
    available: true,
  },
  {
    id: 'members',
    label: 'สมาชิก CRM',
    title: 'สมาชิก CRM',
    subtitle: 'ข้อมูลสมาชิกและมุมมอง CRM',
    icon: Users,
    color: 'bg-blue-500/10 text-blue-600 border-blue-200',
    available: true,
  },
  {
    id: 'loyalty',
    label: 'แต้มสะสม',
    title: 'แต้มสะสม',
    subtitle: 'ระบบแต้มสะสมและระดับสมาชิก',
    icon: Star,
    color: 'bg-amber-500/10 text-amber-600 border-amber-200',
    available: false,
  },
  {
    id: 'campaigns',
    label: 'แคมเปญ',
    title: 'แคมเปญ',
    subtitle: 'จัดการบรอดแคสต์และแคมเปญ',
    icon: Send,
    color: 'bg-rose-500/10 text-rose-600 border-rose-200',
    available: false,
  },
  {
    id: 'line-oa',
    label: 'LINE OA',
    title: 'LINE OA',
    subtitle: 'จัดการบัญชี LINE Official Account',
    icon: Radio,
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
    available: true,
  },
  {
    id: 'rich-menu',
    label: 'Rich Menu',
    title: 'Rich Menu',
    subtitle: 'จัดการเมนู Rich Menu',
    icon: Grid,
    color: 'bg-green-500/10 text-green-600 border-green-200',
    available: true,
  },
  {
    id: 'automation',
    label: 'Automation',
    title: 'Automation',
    subtitle: 'จัดการ Flow และ Automation',
    icon: Zap,
    color: 'bg-indigo-500/10 text-indigo-600 border-indigo-200',
    available: false,
  },
  {
    id: 'ai-mcp',
    label: 'AI MCP',
    title: 'AI MCP',
    subtitle: 'เครื่องมือ AI และการเชื่อมต่อ MCP',
    icon: Bot,
    color: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-200',
    available: false,
  },
  {
    id: 'member-portal',
    label: 'Member Portal',
    title: 'Member Portal',
    subtitle: 'พรีวิวพอร์ทัลสมาชิก',
    icon: Smartphone,
    color: 'bg-cyan-500/10 text-cyan-600 border-cyan-200',
    available: false,
  },
  {
    id: 'audit-log',
    label: 'Audit Log',
    title: 'Audit Log',
    subtitle: 'บันทึกกิจกรรมของระบบ',
    icon: ShieldCheck,
    color: 'bg-amber-500/10 text-amber-700 border-amber-200',
    available: false,
  },
  {
    id: 'settings',
    label: 'ตั้งค่า',
    title: 'ตั้งค่า',
    subtitle: 'ตั้งค่าระบบ',
    icon: Settings,
    color: 'bg-slate-500/10 text-slate-600 border-slate-200',
    available: false,
  },
]

export const AVAILABLE_LINE_CRM_MODULES = LINE_CRM_MODULES.filter(({ available }) => available)

export function getAvailableLineCrmModule(moduleId) {
  return AVAILABLE_LINE_CRM_MODULES.find(({ id }) => id === moduleId)
}

export function normalizeLineCrmTab(tabId) {
  if (tabId === 'hub' || getAvailableLineCrmModule(tabId)) return tabId
  return 'hub'
}
