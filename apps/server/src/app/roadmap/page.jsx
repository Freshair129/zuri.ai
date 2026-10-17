import { renderSignedInMovedNotice } from './moved-notice'

export const metadata = {
  title: 'Developer Delivery Control moved — Zuri',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function RoadmapPage() {
  return renderSignedInMovedNotice('/roadmap')
}
