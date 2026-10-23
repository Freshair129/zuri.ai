import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-187 — release a pinned knowledge runtime without changing the app.
// @spec ADR-075
// @tested tests/unit/ki17-msp-only-release.test.js
const recipePath = resolve('deploy/ki17/overlay/msp-only.Dockerfile')
const recipe = existsSync(recipePath) ? readFileSync(recipePath, 'utf8') : ''
const commands = recipe.split(/\r?\n/).filter(line => !line.trimStart().startsWith('#')).join('\n')

describe('MSP-only frozen application release', () => {
  it('replaces only MSP and its pin receipt, with no application or other runtime copy', () => {
    expect(existsSync(recipePath)).toBe(true)
    const destinations = [...commands.matchAll(/^COPY\s+.*\s+(\S+)\s*$/gm)].map(match => match[1])
    expect(destinations.filter(destination => destination.startsWith('/opt/'))).toEqual([
      '/opt/ki17/msp', '/opt/ki17/pins',
    ])
    expect(destinations.every(destination => destination.startsWith('/opt/') || destination.startsWith('/tmp/'))).toBe(true)
    expect(commands).not.toContain('org.opencontainers.image.revision=')
  })

  it('checks the unchanged base pins before removal and the selected tuple after replacement', () => {
    const checks = [...commands.matchAll(/node \/tmp\/msp-release\/check-ki17-from\.mjs/g)].map(match => match.index)
    expect(checks).toHaveLength(2)
    const removal = commands.indexOf('rm -rf /opt/ki17/msp')
    expect(removal).toBeGreaterThan(checks[0])
    expect(commands.lastIndexOf('COPY --from=signed_msp')).toBeLessThan(checks[1])
    expect(commands).toContain('ARG PREVIOUS_MSP_COMMIT=68e6169dbb371dac2f0debf0bf731b553f7dc26d')
    expect(commands).toContain('manifest.repositories.msp.commit = process.env.PREVIOUS_MSP_COMMIT')
  })

  it('requires separate configuration provenance and restores the chosen runtime user', () => {
    expect(commands).toContain('ARG CONFIG_REVISION')
    expect(commands).toContain('CONFIG_REVISION_REQUIRED')
    expect(commands).toContain('LABEL org.zuri.ki17.configuration-revision=${CONFIG_REVISION}')
    expect(commands.trimEnd()).toMatch(/USER \$\{FINAL_USER\}$/)
    expect(commands).toContain('ARG FINAL_USER=node')
  })
})
