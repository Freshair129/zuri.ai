// @req SEC-001, SEC-018 — destructive migration proofs run only against a
//   test-owned, auto-removed loopback Postgres container with ephemeral storage.
// @spec ADR-104 D5
// @tested tests/unit/production-migration-evidence.test.js

export function assertOwnedDisposableTestDatabase({ databaseUrl, containerId, ownerToken, container }) {
  if (typeof databaseUrl !== 'string' || !containerId || !/^[a-f0-9]{64}$/.test(ownerToken ?? '')) {
    throw new Error('refuse: disposable PostgreSQL owner proof is required')
  }

  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('refuse: disposable PostgreSQL URL is invalid')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      || url.pathname !== '/pm_migration_test'
      || url.username !== 'postgres'
      || !url.password
      || url.search
      || url.hash) {
    throw new Error('refuse: disposable PostgreSQL URL must be exact loopback pm_migration_test without query overrides')
  }

  if (!container || container.Id?.toLowerCase() !== containerId.toLowerCase()) {
    throw new Error('refuse: Docker inspect did not prove the requested test container identity')
  }
  if (!container.Name?.startsWith('/pm-migration-isolated-')
      || container.Config?.Image !== 'postgres:17-alpine'
      || !container.State?.Running
      || container.HostConfig?.AutoRemove !== true) {
    throw new Error('refuse: test database container must be running Postgres 17 and auto-removed')
  }

  const labels = container.Config?.Labels ?? {}
  if (labels['com.zuri-ai.test.purpose'] !== 'production-migration-isolated'
      || labels['com.zuri-ai.test.owner-token'] !== ownerToken) {
    throw new Error('refuse: test database container owner label does not match this run')
  }
  const env = new Set(container.Config?.Env ?? [])
  if (!env.has('POSTGRES_USER=postgres') || !env.has('POSTGRES_DB=pm_migration_test')) {
    throw new Error('refuse: test database container identity environment is incorrect')
  }

  const mounts = container.Mounts ?? []
  if (container.HostConfig?.Binds?.length
      || container.HostConfig?.Tmpfs?.['/var/lib/postgresql/data'] === undefined
      || mounts.some((mount) => mount.Type !== 'tmpfs' || mount.Destination !== '/var/lib/postgresql/data')) {
    throw new Error('refuse: test database must use only disposable tmpfs storage')
  }

  const bindings = container.NetworkSettings?.Ports?.['5432/tcp'] ?? []
  if (bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
      || Number(bindings[0].HostPort) !== Number(url.port)) {
    throw new Error('refuse: test database port must match a loopback-only container binding')
  }

  return { host: url.hostname, port: Number(url.port), database: 'pm_migration_test' }
}
