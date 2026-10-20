#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = 'https://www.aicodingdictionary.com/?q=Agent&term=agent';
const ALLOWED_HOSTNAMES = new Set(['www.aicodingdictionary.com']);
const MAX_HTML_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

const OVERLAY_CSS = readFileSync(new URL('./zuri-overlay.css', import.meta.url), 'utf8');
const BRANDING_SCRIPT = readFileSync(new URL('./branding.js', import.meta.url), 'utf8');

const STYLE_MARKERS = {
  start: '<!-- zuri-graph-theme-preview:styles:start -->',
  end: '<!-- zuri-graph-theme-preview:styles:end -->',
};
const SCRIPT_MARKERS = {
  start: '<!-- zuri-graph-theme-preview:branding:start -->',
  end: '<!-- zuri-graph-theme-preview:branding:end -->',
};

function isPathInside(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent === '' || (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

async function resolveThroughExistingAncestors(targetPath) {
  let cursor = resolve(targetPath);
  const missingParts = [];

  while (true) {
    try {
      const existingPath = await realpath(cursor);
      return resolve(existingPath, ...missingParts.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missingParts.push(basename(cursor));
      cursor = parent;
    }
  }
}

export function validateSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid source URL: ${value}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error('Source URLs must use HTTPS.');
  }
  if (!ALLOWED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(`Source host is not allowed: ${url.hostname}`);
  }
  if (url.username || url.password || url.port) {
    throw new Error('Source URLs may not include credentials or a custom port.');
  }

  return url;
}

export function defaultOutputPath({ id = randomUUID() } = {}) {
  return resolve(tmpdir(), 'zuri-knowledge-graph-preview', `preview-${id}.html`);
}

export async function assertOutputUnderTemp(outputPath) {
  const absoluteOutputPath = resolve(outputPath);
  const canonicalTempRoot = await realpath(tmpdir());
  const canonicalOutputPath = await resolveThroughExistingAncestors(absoluteOutputPath);

  if (!isPathInside(canonicalTempRoot, canonicalOutputPath)) {
    throw new Error(`Generated HTML must be written under the operating system temporary directory (${canonicalTempRoot}).`);
  }

  try {
    const existingOutput = await lstat(absoluteOutputPath);
    if (existingOutput.isSymbolicLink()) {
      throw new Error('Refusing to write through a symbolic-link output path.');
    }
    if (!existingOutput.isFile()) {
      throw new Error('Output path must be a new file path, not a directory or special file.');
    }
    throw new Error('Output file already exists; choose a new output path.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return absoluteOutputPath;
}

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function upsertAttribute(tag, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributePattern = new RegExp(
    `\\s${escapedName}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`,
    'i',
  );
  const attribute = ` ${name}="${escapeAttribute(value)}"`;

  if (attributePattern.test(tag)) {
    return tag.replace(attributePattern, attribute);
  }
  return tag.replace(/\s*\/?>$/, (ending) => `${attribute}${ending}`);
}

function insertAfterOpeningTag(html, tagName, content) {
  const openingTag = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const match = openingTag.exec(html);
  if (!match) return null;
  const insertionPoint = match.index + match[0].length;
  return `${html.slice(0, insertionPoint)}${content}${html.slice(insertionPoint)}`;
}

function insertBeforeClosingTag(html, tagName, content, fallbackTag = null) {
  const closingTag = new RegExp(`</${tagName}\\s*>`, 'i');
  let match = closingTag.exec(html);
  if (!match && fallbackTag) {
    match = new RegExp(`</${fallbackTag}\\s*>`, 'i').exec(html);
  }
  if (!match) return `${html}${content}`;
  return `${html.slice(0, match.index)}${content}${html.slice(match.index)}`;
}

function removeMarkedBlock(html, markers) {
  const escapedStart = markers.start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = markers.end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');
  return html.replace(pattern, '');
}

function makeMarkedBlock(markers, element) {
  return `${markers.start}${element}${markers.end}`;
}

export function transformHtml(sourceHtml, { baseUrl = SOURCE_URL } = {}) {
  if (typeof sourceHtml !== 'string' || !sourceHtml.trim()) {
    throw new Error('Source HTML must be a non-empty string.');
  }
  if (!/<html\b/i.test(sourceHtml)) {
    throw new Error('Source must be a complete HTML document containing an <html> element.');
  }

  const safeBaseUrl = validateSourceUrl(baseUrl).href;
  const encodedCss = OVERLAY_CSS.replace(/<\/style/gi, '<\\/style');
  const encodedScript = BRANDING_SCRIPT.replace(/<\/script/gi, '<\\/script');
  const styleBlock = makeMarkedBlock(
    STYLE_MARKERS,
    `<style id="zuri-graph-theme-preview-styles">\n${encodedCss}\n</style>`,
  );
  const scriptBlock = makeMarkedBlock(
    SCRIPT_MARKERS,
    `<script id="zuri-graph-theme-preview-branding">\n${encodedScript}\n</script>`,
  );

  let html = removeMarkedBlock(sourceHtml, STYLE_MARKERS);
  html = removeMarkedBlock(html, SCRIPT_MARKERS);
  let sourceBaseTag = null;
  html = html.replace(/<base\b[^>]*>/gi, (tag) => {
    if (sourceBaseTag === null) sourceBaseTag = tag;
    return '';
  });
  const baseTag = sourceBaseTag
    ? upsertAttribute(sourceBaseTag, 'href', safeBaseUrl)
    : `<base href="${escapeAttribute(safeBaseUrl)}">`;
  html = html.replace(/<html\b[^>]*>/i, (tag) => upsertAttribute(tag, 'data-zuri-graph-preview', 'true'));

  const headBlock = `${baseTag}${styleBlock}`;
  const withHeadAssets = insertAfterOpeningTag(html, 'head', headBlock);
  if (withHeadAssets === null) {
    html = insertAfterOpeningTag(html, 'html', `<head>${headBlock}</head>`);
  } else {
    html = withHeadAssets;
  }

  const withBodyScript = insertBeforeClosingTag(html, 'body', scriptBlock, 'html');
  return withBodyScript;
}

export async function fetchSourceHtml(startUrl, {
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide the built-in fetch API.');
  }

  let currentUrl = validateSourceUrl(startUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
            'user-agent': 'ZuriKnowledgeGraphLocalPreview/1.0',
          },
        });
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          throw new Error(`Timed out fetching source page after ${timeoutMs} ms.`);
        }
        throw new Error(`Could not fetch source page: ${error?.message ?? String(error)}`);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Source returned redirect ${response.status} without a location.`);
        if (redirects === MAX_REDIRECTS) throw new Error('Source exceeded the redirect limit.');
        currentUrl = validateSourceUrl(new URL(location, currentUrl).href);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Source returned HTTP ${response.status}.`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
        throw new Error(`Source did not return HTML (content type: ${contentType}).`);
      }
      const html = await readResponseHtml(response, controller.signal, timeoutMs);
      return { html, sourceUrl: currentUrl.href };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Source exceeded the redirect limit.');
}

async function readResponseHtml(response, signal, timeoutMs) {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_HTML_BYTES) {
    throw new Error(`Source HTML exceeds the ${MAX_HTML_BYTES} byte limit.`);
  }

  if (!response.body) {
    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      throw new Error(`Source HTML exceeds the ${MAX_HTML_BYTES} byte limit.`);
    }
    if (signal.aborted) throw new Error(`Timed out fetching source page after ${timeoutMs} ms.`);
    return html;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await readWithAbort(reader, signal, timeoutMs);
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_HTML_BYTES) {
        throw new Error(`Source HTML exceeds the ${MAX_HTML_BYTES} byte limit.`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Timed out fetching source page after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    if (signal.aborted || totalBytes > MAX_HTML_BYTES) {
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}

function readWithAbort(reader, signal, timeoutMs) {
  if (signal.aborted) {
    return Promise.reject(new Error(`Timed out fetching source page after ${timeoutMs} ms.`));
  }

  return new Promise((resolveRead, rejectRead) => {
    const onAbort = () => rejectRead(new Error(`Timed out fetching source page after ${timeoutMs} ms.`));
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(resolveRead, rejectRead).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function parseArgs(args) {
  const options = { input: null, url: null, baseUrl: null, output: null, help: false };
  const seen = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--help' || name === '-h') {
      options.help = true;
      continue;
    }
    if (!['--input', '--url', '--base-url', '--output'].includes(name)) {
      throw new Error(`Unknown option: ${name}`);
    }
    if (seen.has(name)) throw new Error(`Option may only be supplied once: ${name}`);
    seen.add(name);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option requires a value: ${name}`);
    options[{ '--input': 'input', '--url': 'url', '--base-url': 'baseUrl', '--output': 'output' }[name]] = value;
    index += 1;
  }

  if (options.input && options.url) throw new Error('Choose either --input or --url, not both.');
  if (options.baseUrl && !options.input) throw new Error('--base-url is only used with --input.');
  if (options.url) validateSourceUrl(options.url);
  if (options.baseUrl) validateSourceUrl(options.baseUrl);
  return options;
}

export async function buildPreview(options, { fetchImpl } = {}) {
  let html;
  let baseUrl;
  let sourceDescription;

  if (options.input) {
    html = await readFile(resolve(options.input), 'utf8');
    baseUrl = options.baseUrl ?? SOURCE_URL;
    sourceDescription = `local capture ${resolve(options.input)}`;
  } else {
    const requestedUrl = validateSourceUrl(options.url ?? SOURCE_URL);
    const fetched = await fetchSourceHtml(requestedUrl.href, { fetchImpl });
    html = fetched.html;
    baseUrl = fetched.sourceUrl;
    sourceDescription = fetched.sourceUrl;
  }

  const outputPath = options.output ? resolve(options.output) : defaultOutputPath();
  const safeOutputPath = await assertOutputUnderTemp(outputPath);
  await mkdir(dirname(safeOutputPath), { recursive: true });
  await assertOutputUnderTemp(safeOutputPath);
  await writeFile(safeOutputPath, transformHtml(html, { baseUrl }), { encoding: 'utf8', flag: 'wx' });

  return { outputPath: safeOutputPath, sourceDescription };
}

export const usage = `Usage:
  node experiments/knowledge-graph-zuri-theme-preview/build-preview.mjs [options]

Options:
  --input <capture.html>  Use a supplied local HTML capture.
  --url <https-url>       Fetch the current source page (default: ${SOURCE_URL}).
  --base-url <https-url>  Set the source page URL for relative links in a capture.
  --output <file>         Write to a new HTML file under the OS temporary directory.
  --help                  Show this help.

Source URLs are restricted to https://www.aicodingdictionary.com. All output paths, including
--output, must resolve under the operating system temporary directory. Existing output files
are never overwritten.`;

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage}\n`);
      return;
    }
    const result = await buildPreview(options);
    process.stdout.write(`Created local preview from ${result.sourceDescription}\n${result.outputPath}\n`);
  } catch (error) {
    process.stderr.write(`Preview build failed: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
