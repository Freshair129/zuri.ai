import { describe, expect, it } from 'vitest'
import { ki17NodeExecutable, isolatedEnvironment, mspTransport } from '../acceptance/harness'

// @req FR-110 — the four-process acceptance spawns MSP, GKS and the worker as real
//   processes; which Node binary it spawns them with is part of what it certifies.
// @req FR-188 — the SmartGift profile runs through the same harness.
// @spec ADR-075, docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md
// @tested tests/unit/ki17-acceptance-harness.test.js

// Gate G-3 runs this suite inside the Phase 3 images, where the test runner is the
// Node 22 the `runner` image ships and MSP/GKS/the worker are the pinned 24.18.x at
// /opt/ki17/node/bin/node. `process.execPath` names only the first of those, so the
// harness needed a way to address the second. These are the guards on that seam.
describe('the Node the acceptance harness spawns its ki17 children with', () => {
  it('is the runner own Node when KI17_NODE is unset, so a native run is unchanged', () => {
    expect(ki17NodeExecutable({})).toBe(process.execPath)
    expect(ki17NodeExecutable({ KI17_NODE: '' })).toBe(process.execPath)
  })

  it('is KI17_NODE when it names an existing absolute executable', () => {
    // process.execPath is the one absolute Node path every platform is guaranteed to
    // have; the assertion is about the resolution, not about which binary it is.
    expect(ki17NodeExecutable({ KI17_NODE: process.execPath })).toBe(process.execPath)
  })

  it('throws rather than falling back when KI17_NODE names nothing', () => {
    // A silent fallback is the failure this exists to prevent: the suite would pass
    // on the wrong runtime and report a G-3 result for a Node the deployment does
    // not ship. Relative paths are refused for the same reason — the children are
    // spawned with several different cwds.
    expect(() => ki17NodeExecutable({ KI17_NODE: '/opt/ki17/node/bin/node-that-is-not-here' }))
      .toThrow(/KI17_NODE must name an existing absolute Node executable/)
    expect(() => ki17NodeExecutable({ KI17_NODE: 'node' }))
      .toThrow(/KI17_NODE must name an existing absolute Node executable/)
  })

  it('is the command MSP gets for GKS, so the whole chain runs on one runtime', () => {
    // isolatedEnvironment reads the roots off process.env, which only the acceptance
    // command guarantees; this unit test supplies them and puts them back.
    const previous = { msp: process.env.KI17_MSP_ROOT, gks: process.env.KI17_GKS_ROOT }
    process.env.KI17_MSP_ROOT = previous.msp ?? '/opt/ki17/msp'
    process.env.KI17_GKS_ROOT = previous.gks ?? '/opt/ki17/gks'
    try {
      const env = isolatedEnvironment('/tmp/ki17-unit', { tenantId: 't', businessId: 'b' })
      expect(env.MSP_GKS_COMMAND).toBe(ki17NodeExecutable(process.env))
    } finally {
      for (const [key, value] of [['KI17_MSP_ROOT', previous.msp], ['KI17_GKS_ROOT', previous.gks]]) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('is refused by mspTransport too, instead of MSP starting on the wrong Node', () => {
    // mspTransport spawns MSP from the test runner process, the one place where the
    // two runtimes differ and `process.execPath` used to be read.
    expect(() => mspTransport({ KI17_NODE: '/nope/node', KI17_MSP_ROOT: '/opt/ki17/msp' }))
      .toThrow(/KI17_NODE/)
  })
})
