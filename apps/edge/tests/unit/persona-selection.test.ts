import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { activePersonaId, agentsRoot, listPersonaOptions, loadPersonaPrompt } from '../../src/answer/persona.js';
import os from 'node:os';
import { ANSWER_RULES, DEFAULT_PERSONA, SYSTEM_PROMPT, answerWithModel } from '../../src/answer/llm.js';
import type { ModelPort, ModelRequest } from '../../src/answer/model-port.js';
import type { Catalog } from '../../src/catalog/store.js';
import { emptyFakeRag } from '../helpers/fake-rag.js';

/**
 * Two defects this pins:
 *
 * 1. The GUI's persona dropdown was two hardcoded options — one of them (`default`) named a
 *    folder that does not exist and fell through to the built-in fallback string without
 *    saying so. The list now comes from `.agents/`, so what is offered is what loads.
 * 2. Only the headless path read the persona at all. OLLAMA_LOCAL / API answered as the
 *    built-in `SYSTEM_PROMPT` whatever `ZURI_ACTIVE_PERSONA` said. The persona now replaces
 *    the identity part of the system prompt on that path too, while the numbers-from-tools
 *    rules stay outside the persona file.
 */

const AGENTS_ROOT = path.resolve('.agents');
const ORIGINAL_ENV = process.env.ZURI_ACTIVE_PERSONA;
const ORIGINAL_ROOTS = { agents: process.env.ZURI_AGENTS_ROOT, pkg: process.env.ZURI_DESKTOP_PACKAGE_ROOT };

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  restore('ZURI_ACTIVE_PERSONA', ORIGINAL_ENV);
  restore('ZURI_AGENTS_ROOT', ORIGINAL_ROOTS.agents);
  restore('ZURI_DESKTOP_PACKAGE_ROOT', ORIGINAL_ROOTS.pkg);
});

describe('where .agents/ is looked for', () => {
  it('defaults to the working directory', () => {
    delete process.env.ZURI_AGENTS_ROOT;
    delete process.env.ZURI_DESKTOP_PACKAGE_ROOT;
    assert.equal(agentsRoot(), AGENTS_ROOT);
  });

  it('inside the Desktop package the worker reads worker/.agents, whatever its cwd is', () => {
    delete process.env.ZURI_AGENTS_ROOT;
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-pkg-'));
    fs.mkdirSync(path.join(pkg, 'worker', '.agents', 'packaged-01'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'worker', '.agents', 'packaged-01', 'AGENTS.md'), '# Persona: packaged\nhello');
    process.env.ZURI_DESKTOP_PACKAGE_ROOT = pkg;
    assert.equal(agentsRoot(), path.join(pkg, 'worker', '.agents'));
    assert.deepEqual(listPersonaOptions().map((o) => o.id), ['packaged-01'].concat(activePersonaId() === 'packaged-01' ? [] : [activePersonaId()]));
    assert.equal(loadPersonaPrompt('packaged-01'), '# Persona: packaged\nhello');
    fs.rmSync(pkg, { recursive: true, force: true });
  });

  it('a package with no worker/.agents falls back to the working directory rather than nowhere', () => {
    delete process.env.ZURI_AGENTS_ROOT;
    process.env.ZURI_DESKTOP_PACKAGE_ROOT = path.join(os.tmpdir(), 'zuri-pkg-does-not-exist');
    assert.equal(agentsRoot(), AGENTS_ROOT);
  });

  it('ZURI_AGENTS_ROOT wins over both', () => {
    process.env.ZURI_DESKTOP_PACKAGE_ROOT = path.join(os.tmpdir(), 'zuri-pkg-ignored');
    process.env.ZURI_AGENTS_ROOT = path.join(os.tmpdir(), 'my-agents');
    assert.equal(agentsRoot(), path.join(os.tmpdir(), 'my-agents'));
  });
});

describe('persona options come from .agents/', () => {
  it('lists every folder that has an AGENTS.md, with the heading as its label', () => {
    delete process.env.ZURI_ACTIVE_PERSONA;
    const onDisk = fs
      .readdirSync(AGENTS_ROOT)
      .filter((name) => fs.existsSync(path.join(AGENTS_ROOT, name, 'AGENTS.md')))
      .sort();
    const options = listPersonaOptions();
    assert.deepEqual(options.map((o) => o.id).sort(), onDisk);
    const zuri = options.find((o) => o.id === 'zuri-01');
    assert.ok(zuri, 'the committed zuri-01 persona is listed');
    assert.ok(zuri.label.startsWith('zuri-01 — '), `label carries the heading: ${zuri.label}`);
    assert.ok(!options.some((o) => o.id === 'default'), 'no phantom "default" option');
  });

  it('keeps an active persona that has no folder visible, and says it is the fallback', () => {
    process.env.ZURI_ACTIVE_PERSONA = '__missing_persona__';
    const missing = listPersonaOptions().find((o) => o.id === '__missing_persona__');
    assert.ok(missing, 'the configured id stays selectable rather than silently vanishing');
    assert.match(missing.label, /ไม่พบ/);
  });

  it('activePersonaId reads the environment at call time', () => {
    delete process.env.ZURI_ACTIVE_PERSONA;
    assert.equal(activePersonaId(), 'zuri-01');
    process.env.ZURI_ACTIVE_PERSONA = 'zuri-01';
    assert.equal(activePersonaId(), 'zuri-01');
    process.env.ZURI_ACTIVE_PERSONA = '  ';
    assert.equal(activePersonaId(), 'zuri-01', 'blank means default');
  });
});

describe('the API/Ollama path answers as the selected persona', () => {
  const capture = (): { port: ModelPort; requests: ModelRequest[] } => {
    const requests: ModelRequest[] = [];
    return {
      requests,
      port: {
        id: 'capture',
        model: 'capture',
        generate: async (request) => {
          requests.push(request);
          return { text: '' }; // empty = deterministic reply; we only care what was sent
        },
      },
    };
  };
  const catalog: Catalog = { products: [], byCode: new Map() };
  const evidence = () => ({ catalog, role: 'sales' as const, exchangeRate: 5, rag: emptyFakeRag() });

  it('SYSTEM_PROMPT is exactly the default persona plus the answer rules', () => {
    assert.equal(SYSTEM_PROMPT, DEFAULT_PERSONA + '\n\n' + ANSWER_RULES);
    assert.match(ANSWER_RULES, /กติกาเรื่องตัวเลข/);
    assert.doesNotMatch(DEFAULT_PERSONA, /กติกาเรื่องตัวเลข/);
  });

  it('without a persona argument the system prompt is unchanged from before', async () => {
    const { port, requests } = capture();
    await answerWithModel('ราคาเท่าไร', [], 'sales', evidence(), { port, timeoutMs: 5000, maxIterations: 1 }, 'fallback');
    assert.equal(requests.length, 1);
    assert.ok(requests[0].system.startsWith(SYSTEM_PROMPT), 'default = the historical SYSTEM_PROMPT');
  });

  it('with the .agents/ persona the identity part is replaced and the number rules survive', async () => {
    const { port, requests } = capture();
    const persona = loadPersonaPrompt('zuri-01');
    assert.ok(persona.includes('# Persona: Zuri'), 'reads the committed AGENTS.md');
    await answerWithModel('ราคาเท่าไร', [], 'sales', evidence(), { port, timeoutMs: 5000, maxIterations: 1 }, 'fallback', persona);
    const system = requests[0].system;
    assert.ok(system.startsWith(persona), 'persona leads the system prompt');
    assert.ok(system.includes(ANSWER_RULES), 'numbers-from-tools rules cannot be dropped by a persona file');
    assert.ok(!system.includes(DEFAULT_PERSONA), 'the built-in identity is not sent twice');
  });
});
