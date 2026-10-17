import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import PlatformControlSessionRetry from '@/components/layouts/PlatformControlSessionRetry'
import { SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH, classifyViewerFailure } from '@/lib/viewer-failure'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

function serverRequest(pathname) {
  const cookieHeader = cookies().getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ')
  return new Request(`https://zuri.local${pathname}`, { headers: { cookie: cookieHeader } })
}

export function DeveloperDeliveryControlMovedNotice() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-7 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--action-primary)]">Developer Delivery Control</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">This dashboard has moved</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          The 24-week developer roadmap and its worker, CI, worktree, and event views are now in the private standalone repository.
        </p>
        <p className="mt-4 text-sm">
          <a
            className="font-semibold underline underline-offset-2"
            href="https://github.com/Freshair129/zuri-delivery-control"
            rel="noreferrer"
            target="_blank"
          >
            Freshair129/zuri-delivery-control
          </a>
        </p>
        <p className="mt-4 text-sm leading-6 text-muted">
          For local use, follow the repository README to configure your checkout, run <code>npm start</code>, then open{' '}
          <a className="font-semibold underline underline-offset-2" href="http://127.0.0.1:4191">
            http://127.0.0.1:4191
          </a>.
        </p>
      </section>
    </main>
  )
}

export async function renderSignedInMovedNotice(pathname) {
  let viewer = null
  try {
    viewer = await resolveRequestViewer(serverRequest(pathname))
  } catch (error) {
    const failure = classifyViewerFailure({ status: error?.status, body: error?.message })
    if (failure === 'SESSION_UNAVAILABLE') {
      return <PlatformControlSessionRetry title={SESSION_UNAVAILABLE_TITLE_TH} detail={SESSION_UNAVAILABLE_DETAIL_TH} />
    }
    redirect('/login')
  }

  if (!viewer) redirect('/login')
  return <DeveloperDeliveryControlMovedNotice />
}
