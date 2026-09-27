# Local provider conformance: BFF → Market service → core façade

This is a verification harness only (delegated ruling Q11, ADR-108 D4). It runs the
console's two Market routes through a real browser session twice, from the same seeded
disposable database:

1. `MARKET_EXECUTOR` unset: the legacy in-process path.
2. `MARKET_EXECUTOR=service`: BFF → Market service (sqlite store) → core façade.

It then asserts the responses are identical, and checks directly in the databases where
the observation rows and audit events landed.

**Everything is disposable.** It uses its own folder, port 3191/3192 and its own SQLite
files. `MARKET_EXECUTOR=service` exists only in the environment of the one dev-server
process. It never touches `.env`, the `zuri-ai` Compose project, ngrok or any real
database. `setup-raw.mjs` refuses a `DATABASE_URL` outside `CONFORMANCE_DIR`.

## Replay (PowerShell, from the repository root; branch with the façade)

```powershell
$d = "$env:TEMP\market-conformance"; New-Item -ItemType Directory -Force $d | Out-Null
$env:CONFORMANCE_DIR = $d; $env:CONFORMANCE_PASSWORD = 'conformance-pass-1'
cd apps/server
$env:DATABASE_URL = "file:$($d.Replace('\','/'))/base.db"
npx prisma db push --skip-generate
$env:ZURI_SEED_OWNER_PASSWORD = $env:CONFORMANCE_PASSWORD; node prisma/seed.js
node ../../services/market-intelligence/conformance/setup-raw.mjs   # prints businessId
Copy-Item "$d\base.db" "$d\legacy.db"; Copy-Item "$d\base.db" "$d\service.db"
```

Run 1 (legacy). In one terminal:

```powershell
$env:DATABASE_URL = "file:$($d.Replace('\','/'))/legacy.db"; $env:ZURI_SESSION_SECRET = '<32+ chars>'
npx next dev -p 3191
```

In another terminal: `BASE=http://127.0.0.1:3191`, `BUSINESS_ID=<printed id>`,
`OUT=$d\legacy.json`, then `node services/market-intelligence/conformance/driver.mjs`.
Stop the server.

Run 2 (service). Restart the dev server with `DATABASE_URL=…/service.db`,
`MARKET_EXECUTOR=service`, `MARKET_SERVICE_URL=http://127.0.0.1:3192`,
`MARKET_SERVICE_TOKEN=<A>` and `MARKET_CORE_TOKEN=<B>`. Start the service from
`services/market-intelligence` with `MARKET_ENV=test`, `MARKET_PORT=3192`,
`MARKET_API_TOKEN=<A>`, `MARKET_CORE_TOKEN=<B>`, `MARKET_CORE_URL=http://127.0.0.1:3191`,
`MARKET_STORE=sqlite` and `MARKET_SQLITE_PATH=$d\service-store.db`, then run
`node src/main.js`. Run the driver with `OUT=$d\service.json`.

Compare: `node --no-warnings services/market-intelligence/conformance/compare.mjs <dir with forward slashes>`.
It must print `RESULT: PARITY`, show `service.db MarketObservation rows: 0` with
`service-store.db rows: 3`, and show identical audit payloads.

## Result on record

See `docs/migrations/service-extraction/MARKET-INTELLIGENCE-HANDOFF.md`, section
"Local provider conformance". The result is LOCAL and has not been reviewed by the
integrator.
