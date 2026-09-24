// Single-source guard: the generated kernel equals what sync-kernel.mjs produces
// from the current apps/server sources. Needs the repository checkout (not the
// image); fails — never skips — when the sources are missing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate, transform } from '../../scripts/sync-kernel.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('src/kernel is byte-identical to the generated mirror of apps/server', () => {
  const { files, manifest } = generate()
  for (const file of files) assert.equal(readFileSync(join(root, file.kernel), 'utf8'), file.output, `${file.kernel} drifted — run npm run kernel:sync`)
  assert.equal(readFileSync(join(root, 'src', 'kernel', 'KERNEL-MANIFEST.json'), 'utf8'), manifest)
})

test('the transform only rewrites import specifiers', () => {
  const src = "import { z } from 'zod'\nimport { A } from '@/lib/validation/enums'\nimport { B } from './inventory-costing'\nconst s = 'from ./x'\n"
  const out = transform(src, 'modules/inventory/domain/inventory.js', 'inventory/inventory.js')
  assert.equal(out, "import { z } from 'zod'\nimport { A } from '../lib/enums.js'\nimport { B } from './inventory-costing.js'\nconst s = 'from ./x'\n")
  assert.throws(() => transform("import x from '@/modules/crm/thing'", 'modules/inventory/domain/inventory.js', 'inventory/inventory.js'), /not in the kernel manifest/)
})
