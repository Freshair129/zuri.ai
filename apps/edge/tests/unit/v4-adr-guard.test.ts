import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The LINE agent process must never open a GenesisBlock store directly (§5.8, AC-D4): every path
 * a customer's message can reach — `src/answer/**`, `src/cli/index.ts`, `src/rag/genesis-rag.ts` —
 * talks to `zuri-rag-service` over HTTP only. This test greps the actual committed source rather
 * than trusting a comment, because a forbidden import re-appears silently the moment someone
 * "temporarily" wires the native binding back in for a debug route.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const FORBIDDEN_STRINGS = [
  'gks-genesis-block-native',
  'GenesisDatabase.open',
  'hybridSearch(',
  'executeHql(',
  'genesis-native',
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function guardedFiles(): string[] {
  return [...walkTsFiles(path.join(REPO_ROOT, 'src', 'answer')), path.join(REPO_ROOT, 'src', 'cli', 'index.ts'), path.join(REPO_ROOT, 'src', 'rag', 'genesis-rag.ts')];
}

describe('v4 ADR guard: the LINE agent process never opens the catalog graph store directly', () => {
  for (const forbidden of FORBIDDEN_STRINGS) {
    it(`none of src/answer/**, src/cli/index.ts, src/rag/genesis-rag.ts contain "${forbidden}"`, () => {
      const offenders: string[] = [];
      for (const file of guardedFiles()) {
        const text = fs.readFileSync(file, 'utf8');
        if (text.includes(forbidden)) offenders.push(path.relative(REPO_ROOT, file));
      }
      assert.deepStrictEqual(offenders, [], `forbidden string "${forbidden}" found in: ${offenders.join(', ')}`);
    });
  }

  it('src/rag/genesis-native.ts no longer exists (ADR-119): nothing can open the catalog graph store', () => {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src', 'rag', 'genesis-native.ts')), false);
  });

  it('src/cli/index.ts does not contain the injected-context marker "[ข้อมูลสินค้าจาก"', () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'src', 'cli', 'index.ts'), 'utf8');
    assert.ok(!text.includes('[ข้อมูลสินค้าจาก'), 'cli/index.ts still concatenates ragContext into the text handed to answerConversation');
  });
});
