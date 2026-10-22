import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  assertOutputUnderTemp,
  buildPreview,
  defaultOutputPath,
  fetchSourceHtml,
  parseArgs,
  transformHtml,
  validateSourceUrl,
} from '../build-preview.mjs';

const sourceUrl = 'https://www.aicodingdictionary.com/?q=Agent&term=agent';
const sourceHtml = `<!doctype html>
<html lang="en"><head><title>The AI Coding Dictionary</title>
<script id="graph-data">window.graph={"nodes":[{"id":"agent","label":"Agent"}]};</script>
</head><body><h1>The AI Coding Dictionary</h1><h2>HEARD IN THE WILD</h2>
<h2>AVOID</h2><h2>CONNECTS TO</h2><span id="count">12 TERMS</span>
<a id="credit" href="https://aihero.dev/about">AIHero.dev</a>
<div id="graph-root"><canvas width="640" height="480"></canvas></div></body></html>`;

test('injects separate Zuri CSS and branding blocks', () => {
  const result = transformHtml(sourceHtml, { baseUrl: sourceUrl });

  assert.match(result, /<style id="zuri-graph-theme-preview-styles">/);
  assert.match(result, /--zuri-amber-citrus:\s*#E8820C/);
  assert.match(result, /font-family:\s*"IBM Plex Sans Thai", Manrope, sans-serif/);
  assert.match(result, /<script id="zuri-graph-theme-preview-branding">/);
  assert.match(result, /Zuri Knowledge Graph/);
  assert.equal((result.match(/zuri-graph-theme-preview:styles:start/g) ?? []).length, 1);
  assert.equal((result.match(/zuri-graph-theme-preview:branding:start/g) ?? []).length, 1);
});

test('sets a source base URL and resolves relative resources at the source origin', () => {
  const pageUrl = 'https://www.aicodingdictionary.com/graph/view?q=agent';
  const result = transformHtml(sourceHtml, { baseUrl: pageUrl });
  const baseTag = result.match(/<base href="([^"]+)">/i)?.[1];

  assert.equal(baseTag, pageUrl);
  assert.equal(new URL('assets/graph.js', baseTag).href, 'https://www.aicodingdictionary.com/graph/assets/graph.js');
  assert.equal(new URL(baseTag).origin, 'https://www.aicodingdictionary.com');
  assert.equal((result.match(/<base\b/gi) ?? []).length, 1);
});

test('replaces the source base href while preserving its other link behavior', () => {
  const pageUrl = 'https://www.aicodingdictionary.com/graph/view';
  const capture = sourceHtml.replace('<head>', '<head><base target="_blank" href="/old" referrerpolicy="no-referrer">');
  const result = transformHtml(capture, { baseUrl: pageUrl });

  assert.match(result, /<base target="_blank" href="https:\/\/www\.aicodingdictionary\.com\/graph\/view" referrerpolicy="no-referrer">/);
  assert.equal((result.match(/<base\b/gi) ?? []).length, 1);
});

test('validates HTTPS source URLs on the allowlisted publisher host', () => {
  assert.equal(validateSourceUrl(sourceUrl).href, sourceUrl);
  assert.throws(() => validateSourceUrl('http://www.aicodingdictionary.com/'), /HTTPS/);
  assert.throws(() => validateSourceUrl('https://example.com/'), /not allowed/);
  assert.throws(() => validateSourceUrl('https://user@www.aicodingdictionary.com/'), /credentials/);
});

test('is idempotent and replaces only its own injected blocks', () => {
  const once = transformHtml(sourceHtml, { baseUrl: sourceUrl });
  const twice = transformHtml(once, { baseUrl: sourceUrl });

  assert.equal(twice, once);
  assert.equal((twice.match(/<style id="zuri-graph-theme-preview-styles">/g) ?? []).length, 1);
  assert.equal((twice.match(/<script id="zuri-graph-theme-preview-branding">/g) ?? []).length, 1);
});

test('preserves source graph data, graph markup, and publisher link targets', () => {
  const original = sourceHtml;
  const result = transformHtml(sourceHtml, { baseUrl: sourceUrl });

  assert.equal(sourceHtml, original);
  assert.match(result, /window\.graph=\{"nodes":\[\{"id":"agent","label":"Agent"\}\]\};/);
  assert.match(result, /<canvas width="640" height="480"><\/canvas>/);
  assert.match(result, /href="https:\/\/aihero\.dev\/about"/);
  assert.match(result, /data-zuri-graph-preview="true"/);
});

test('rebrands visible source labels while leaving excluded content untouched', async () => {
  const script = await readFile(new URL('../branding.js', import.meta.url), 'utf8');
  const makeNode = (value, { excluded = false, creditHref = null } = {}) => ({
    nodeValue: value,
    parentElement: {
      closest: (selector) => {
        if (selector === 'a[href]' && creditHref) {
          return { href: creditHref, textContent: value };
        }
        if (selector !== 'a[href]' && excluded) return {};
        return null;
      },
    },
  });
  const textNodes = [
    'The AI Coding Dictionary',
    'HEARD IN THE WILD',
    'AVOID',
    'CONNECTS TO',
    '12 TERMS',
    'AI Hero',
    'AIHero.dev',
    'aihero.dev',
    'N TERMS',
    'AI Hero source data',
  ].map((value, index) => makeNode(value, {
    excluded: index === 9,
    creditHref: index === 6 ? 'https://aihero.dev/about' : index === 7 ? 'https://www.aihero.dev/' : null,
  }));
  let cursor = 0;
  const document = {
    title: 'The AI Coding Dictionary',
    documentElement: { dataset: {} },
    body: {},
    readyState: 'complete',
    baseURI: sourceUrl,
    createTreeWalker: () => ({ nextNode: () => textNodes[cursor++] ?? null }),
  };

  runInNewContext(script, { document, NodeFilter: { SHOW_TEXT: 4 } });

  assert.equal(document.title, 'Zuri Knowledge Graph');
  assert.deepEqual(textNodes.slice(0, 9).map((node) => node.nodeValue), [
    'Zuri Knowledge Graph', 'IN CONTEXT', 'USAGE NOTE', 'RELATED KNOWLEDGE', '12 NODES', 'Zuri.ai', 'AIHero.dev', 'aihero.dev', 'N NODES',
  ]);
  assert.equal(textNodes[6].parentElement.closest('a[href]').href, 'https://aihero.dev/about');
  assert.equal(textNodes[7].parentElement.closest('a[href]').href, 'https://www.aihero.dev/');
  assert.equal(textNodes[9].nodeValue, 'AI Hero source data');
});

test('rejects redirects outside the source host allowlist', async () => {
  const mockFetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://example.com/redirected-page' },
  });

  await assert.rejects(fetchSourceHtml(sourceUrl, { fetchImpl: mockFetch }), /not allowed/);
});

test('enforces the HTML byte limit while streaming the response body', async () => {
  const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
  const mockFetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(oversized);
      controller.close();
    },
  }), { headers: { 'content-type': 'text/html' } });

  await assert.rejects(fetchSourceHtml(sourceUrl, { fetchImpl: mockFetch }), /exceeds the 20971520 byte limit/);
});

test('keeps the timeout active while the response body is being consumed', { timeout: 1_000 }, async () => {
  const mockFetch = async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('aborted body')), { once: true });
    },
  }), { headers: { 'content-type': 'text/html' } });

  await assert.rejects(
    fetchSourceHtml(sourceUrl, { fetchImpl: mockFetch, timeoutMs: 15 }),
    /Timed out fetching source page after 15 ms/,
  );
});

test('writes a local capture to a new OS-temp path without modifying the input', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'zuri-graph-preview-test-'));
  const capturePath = join(scratch, 'capture.html');
  const outputPath = join(scratch, 'preview.html');
  try {
    await writeFile(capturePath, sourceHtml, 'utf8');
    const result = await buildPreview(
      { input: capturePath, baseUrl: sourceUrl, output: outputPath },
    );
    const output = await readFile(outputPath, 'utf8');

    assert.equal(result.outputPath, resolve(outputPath));
    assert.match(output, /Zuri Knowledge Graph/);
    assert.equal(await readFile(capturePath, 'utf8'), sourceHtml);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('requires all output paths to resolve inside OS temp', async () => {
  const insideRepo = join(process.cwd(), 'experiments', 'knowledge-graph-zuri-theme-preview', 'preview.html');
  const siblingWorktree = join(resolve(process.cwd(), '..'), 'another-worktree', 'preview.html');
  await assert.rejects(assertOutputUnderTemp(insideRepo), /under the operating system temporary directory/);
  await assert.rejects(assertOutputUnderTemp(siblingWorktree), /under the operating system temporary directory/);
  const defaultPath = defaultOutputPath();
  assert.equal(await assertOutputUnderTemp(defaultPath), resolve(defaultPath));
});

test('parses input, source URL, and rejects mixed or unsupported options', () => {
  assert.deepEqual(parseArgs(['--input', 'capture.html', '--base-url', sourceUrl]), {
    input: 'capture.html', url: null, baseUrl: sourceUrl, output: null, help: false,
  });
  assert.throws(() => parseArgs(['--input', 'capture.html', '--url', sourceUrl]), /either --input or --url/);
  assert.throws(() => parseArgs(['--url', 'https://example.com/']), /not allowed/);
  assert.throws(() => parseArgs(['--mystery']), /Unknown option/);
});
