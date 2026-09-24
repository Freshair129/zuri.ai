import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The live stack is the Compose project `zuri-ai`; one plain `compose up` with the
// wrong file recreated it on 2026-09-11. The Market rehearsal must never resolve to
// that project, never join its network, and the image must never mount source.

const compose = readFileSync(new URL('../compose.rehearsal.yml', import.meta.url), 'utf8')
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const ignore = readFileSync(new URL('../Dockerfile.dockerignore', import.meta.url), 'utf8')

test('the rehearsal is its own Compose project', () => {
  const name = compose.match(/^name:\s*(\S+)/m)?.[1]
  assert.ok(name, 'compose file must pin a project name')
  assert.notEqual(name, 'zuri-ai')
  assert.doesNotMatch(compose, /zuri-network|external:\s*true/)
  assert.doesNotMatch(compose, /ngrok/i)
})

test('only loopback ports are published', () => {
  for (const line of compose.split('\n').filter((l) => /^\s*-\s*"[\d.:]+"/.test(l))) {
    assert.match(line, /"127\.0\.0\.1:/)
  }
})

test('the service image copies only its own package and mounts nothing', () => {
  const copies = dockerfile.split('\n').filter((line) => line.startsWith('COPY'))
  for (const line of copies) assert.match(line, /^COPY services\/market-intelligence\//)
  const instructions = dockerfile.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
  assert.doesNotMatch(instructions, /apps\/server|next build|prisma/i)
  assert.match(ignore, /^\*$/m)
  const serviceBlock = compose.slice(compose.indexOf('  market-intelligence:'))
  assert.doesNotMatch(serviceBlock, /volumes:/)
})
