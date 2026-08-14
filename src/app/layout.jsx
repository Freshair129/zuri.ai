import './globals.css'
import { ScopeProvider } from '@/context/ScopeContext'

// @req FR-044 — keep entry and business-routing surfaces outside the BusinessShell.
// @spec ADR-015, SDD-022 — AppShell is mounted only by the protected PM layout.
// @tested tests/unit/entry-routing-boundary.test.js

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3100'),
  title: 'Zuri — See the whole business. Move with clarity.',
  description: 'Zuri is a local-first, AI-ready business operating system built for clear, human-controlled execution.',
  icons: {
    icon: [{ url: '/zuri-signal.svg', type: 'image/svg+xml' }],
  },
  openGraph: {
    title: 'Zuri — See the whole business. Move with clarity.',
    description: 'One clear operating system for business, work, teams, and decisions.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Zuri operational signal map' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zuri — See the whole business. Move with clarity.',
    description: 'One clear operating system for business, work, teams, and decisions.',
    images: ['/og.png'],
  },
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
