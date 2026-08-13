import './globals.css'
import { ScopeProvider } from '@/context/ScopeContext'

// @req FR-044 — keep entry and business-routing surfaces outside the BusinessShell.
// @spec ADR-015, SDD-022 — AppShell is mounted only by the protected PM layout.
// @tested tests/unit/entry-routing-boundary.test.js

export const metadata = {
  title: 'Zuri v2 — Project Manager',
  description: 'Offline-first portfolio project manager (Zuri v2 lab)',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ScopeProvider>{children}</ScopeProvider>
      </body>
    </html>
  )
}
