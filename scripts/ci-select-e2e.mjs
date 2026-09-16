import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const documentation = /^(docs\/|\.brain\/|AGENTS\.md$|CLAUDE\.md$|README\.md$)/

// Mapping from code paths to targeted e2e test specifications (relative to apps/server)
export const DOMAIN_E2E_MAPPING = [
  // Authentication, Onboarding & User Profile
  {
    pattern: /apps\/server\/(src\/(modules\/identity|app\/\(auth\)|app\/\(entry\)|app\/\(pm\)\/profile))/,
    specs: [
      'tests/e2e/smoke.spec.js',
      'tests/e2e/fr041-business-first.spec.js',
      'tests/e2e/fr044-entry-routing.spec.js',
      'tests/e2e/fr046-entry-contract.spec.js',
      'tests/e2e/fr066-waiting-room.spec.js',
      'tests/e2e/fr104-password-reset-redemption.spec.js',
      'tests/e2e/fr120-signup.spec.js',
    ],
  },
  // Project Manager & Workspaces
  {
    pattern: /apps\/server\/(src\/(modules\/project-manager|app\/\(pm\)\/(projects|workspaces|work)))/,
    specs: [
      'tests/e2e/fr040-project-work.spec.js',
      'tests/e2e/fr045-files.spec.js',
      'tests/e2e/fr058-file-views.spec.js',
      'tests/e2e/fr077-project-inventory.spec.js',
    ],
  },
  // SCM, Inventory & Procurement
  {
    pattern: /apps\/server\/(src\/(modules\/(scm|inventory|procurement)|app\/\(pm\)\/(inventory|procurement)))/,
    specs: [
      'tests/e2e/fr154-inventory-dashboard.spec.js',
      'tests/e2e/fr164-procurement.spec.js',
      'tests/e2e/fr165-receipt-workstation.spec.js',
      'tests/e2e/fr184-stocktake.spec.js',
    ],
  },
  // CRM, LINE OA & Customer Inbox
  {
    pattern: /apps\/server\/(src\/(modules\/(crm|line-oa)|app\/\(pm\)\/(customer|line-oa)))/,
    specs: [
      'tests/e2e/fr091-conversation-inbox.spec.js',
      'tests/e2e/fr149-line-server-console.spec.js',
      'tests/e2e/fr151-line-oa-rich-menu-console.spec.js',
      'tests/e2e/fr161-sales-tasks.spec.js',
    ],
  },
  // Commerce & Billing (POS)
  {
    pattern: /apps\/server\/(src\/(modules\/(commerce|billing)|app\/\(pm\)\/(commerce|billing)))/,
    specs: [
      'tests/e2e/fr166-commerce-orders.spec.js',
      'tests/e2e/fr186-billing-pos.spec.js',
    ],
  },
  // Marketing & Growth
  {
    pattern: /apps\/server\/(src\/(modules\/marketing|app\/\(pm\)\/growth))/,
    specs: [
      'tests/e2e/marketing-campaigns.spec.js',
      'tests/e2e/marketing-content.spec.js',
      'tests/e2e/marketing-p5.spec.js',
      'tests/e2e/marketing-strategy.spec.js',
      'tests/e2e/fr059-strategy-edit.spec.js',
    ],
  },
  // Platform, Integrations & Plugins
  {
    pattern: /apps\/server\/(src\/(platform|app\/\(pm\)\/(settings|platform)))/,
    specs: [
      'tests/e2e/fr080-integration-scope-switch.spec.js',
      'tests/e2e/fr123-plugin-consent.spec.js',
      'tests/e2e/fr124-product-readiness.spec.js',
      'tests/e2e/fr130-connector-catalog.spec.js',
    ],
  },
  // Edge runtime changes
  {
    pattern: /(apps\/edge|apps\/server\/src\/app\/\(pm\)\/edge)/,
    specs: [
      'tests/e2e/edge-desktop-ui.spec.js',
      'tests/e2e/edge-pairing.spec.js',
    ],
  },
]

// Core / Cross-Cutting changes that warrant running the core smoke & navigation suite
export const CORE_PATTERNS = [
  /prisma\/schema/,
  // The e2e harness: files that gate EVERY spec rather than exercising one.
  //
  // `prisma/seed.js` runs inside `tests/e2e/global-setup.js` before any spec,
  // so a broken seed kills the whole suite before a single test starts — and
  // no unit or integration test can see it, because those build their rows
  // through `tests/factories/*` and never execute the seed. That happened on
  // 2026-09-12: ADR-078 D1 rescoped LegalEntity from Portfolio to Tenant, the
  // seed still passed the dropped `portfolioId`, and e2e died in global-setup
  // while all 4,923 unit and integration tests passed. It was caught only
  // because that change happened to touch `prisma/schema.prisma` too; on its
  // own, the seed matched nothing here and e2e was skipped entirely.
  //
  // The same was true of every other file the run stands on — the Playwright
  // config, global setup, and the warm-up that compiles each route before the
  // specs measure it. None of them is a `.spec.js`, so the direct-spec-edit
  // rule below misses them, and none lives under `src/`, so the server-code
  // fallback misses them as well. A change to any one of them can only be
  // judged by running specs, so they select the core suite.
  /prisma\/seed/,
  /apps\/server\/playwright\.config/,
  /apps\/server\/tests\/e2e\/(global-setup|warmup|warmup-routes|e2e-target|e2e-auth)/,
  /apps\/server\/src\/components\/(layouts|ui)/,
  /apps\/server\/src\/context/,
  /apps\/server\/src\/config/,
  /apps\/server\/src\/lib\/shell-mode/,
  /apps\/server\/src\/app\/(layout|globals)/,
  /apps\/server\/src\/app\/\(pm\)\/overview/,
  /apps\/server\/src\/app\/\(pm\)\/page/,
]

export const CORE_SPECS = [
  'tests/e2e/smoke.spec.js',
  'tests/e2e/navigation-reachability.spec.js',
  'tests/e2e/fr060-business-home.spec.js',
]

export function resolveServerRoot(baseDir = process.cwd()) {
  if (existsSync(path.join(baseDir, 'apps/server/tests/e2e'))) {
    return path.join(baseDir, 'apps/server')
  }
  if (existsSync(path.join(baseDir, 'tests/e2e'))) {
    return baseDir
  }
  return path.resolve('apps/server')
}

/**
 * Select targeted e2e specs based on a list of changed file paths.
 *
 * @param {string|string[]} changedFiles - newline-delimited text or array of file paths
 * @param {object} options
 * @param {boolean} [options.forceAll=false] - run the full suite unconditionally
 * @param {string} [options.serverRoot] - base directory to verify spec file existence
 * @returns {{ runAll: boolean, skip: boolean, specs: string[], reason: string }}
 */
export function selectE2ETargets(changedFiles, options = {}) {
  const { forceAll = false, serverRoot = resolveServerRoot() } = options

  if (forceAll) {
    return { runAll: true, skip: false, specs: [], reason: 'force-all requested' }
  }

  const rawList = Array.isArray(changedFiles)
    ? changedFiles
    : String(changedFiles).split(/\r?\n/)
  const paths = rawList.map((p) => p.trim()).filter(Boolean)

  if (paths.length === 0) {
    return { runAll: false, skip: true, specs: [], reason: 'no files changed' }
  }

  // If all modified files are documentation or root meta files, skip e2e
  const isDocOnly = paths.every((file) => documentation.test(file))
  if (isDocOnly) {
    return { runAll: false, skip: true, specs: [], reason: 'documentation-only changes' }
  }

  const selectedSpecs = new Set()
  let hasCoreChange = false
  let hasDirectSpec = false
  let hasDomainMatch = false

  for (const file of paths) {
    // 1. Direct e2e spec edit: always include the edited spec
    if (file.includes('tests/e2e/') && file.endsWith('.spec.js')) {
      const specRel = file.replace(/^.*tests\/e2e\//, 'tests/e2e/')
      selectedSpecs.add(specRel)
      hasDirectSpec = true
      continue
    }

    // 2. Core/Cross-Cutting changes
    if (CORE_PATTERNS.some((pattern) => pattern.test(file))) {
      hasCoreChange = true
      CORE_SPECS.forEach((s) => selectedSpecs.add(s))
    }

    // 3. Domain mappings
    for (const { pattern, specs } of DOMAIN_E2E_MAPPING) {
      if (pattern.test(file)) {
        hasDomainMatch = true
        specs.forEach((s) => selectedSpecs.add(s))
      }
    }
  }

  // 4. Fallback: If server code was touched but didn't match any specific domain
  // (e.g. general helper, generic route), run the core smoke suite
  const serverCodeChanged = paths.some((f) => f.startsWith('apps/server/src/') || f.startsWith('src/'))
  if (serverCodeChanged && selectedSpecs.size === 0) {
    CORE_SPECS.forEach((s) => selectedSpecs.add(s))
  }

  // Filter against real disk existence if serverRoot exists
  const validatedSpecs = Array.from(selectedSpecs).filter((spec) => {
    const fullPath = path.join(serverRoot, spec)
    return existsSync(fullPath)
  })

  if (validatedSpecs.length === 0) {
    return { runAll: false, skip: true, specs: [], reason: 'no matching e2e targets found' }
  }

  let reason = 'domain-targeted'
  if (hasCoreChange) reason = 'core-infrastructure-impact'
  else if (hasDirectSpec) reason = 'direct-spec-edit'
  else if (hasDomainMatch) reason = 'domain-impact'

  return {
    runAll: false,
    skip: false,
    specs: validatedSpecs,
    reason,
  }
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const forceAll = args.includes('--all') || process.env.GITHUB_REF === 'refs/heads/main'

  let input = ''
  if (args.length > 0 && !args[0].startsWith('--')) {
    input = args[0]
  } else {
    try {
      input = readFileSync(0, 'utf8')
    } catch {
      input = ''
    }
  }

  const result = selectE2ETargets(input, { forceAll })

  console.log(`run_all=${result.runAll}`)
  console.log(`skip=${result.skip}`)
  console.log(`reason=${result.reason}`)
  console.log(`specs=${result.specs.join(' ')}`)
}
