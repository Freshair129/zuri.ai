import './globals.css'
import { ScopeProvider } from '@/context/ScopeContext'
import AppShell from '@/components/layouts/AppShell'

export const metadata = {
  title: 'Zuri v2 — Project Manager',
  description: 'Offline-first portfolio project manager (Zuri v2 lab)',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ScopeProvider>
          <AppShell>{children}</AppShell>
        </ScopeProvider>
      </body>
    </html>
  )
}
