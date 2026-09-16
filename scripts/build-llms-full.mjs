#!/usr/bin/env node
/**
 * Build llms-full.txt — the expanded companion to llms.txt.
 *
 * llms.txt is the index: a short statement of what zuri-ai is plus curated
 * links. llms-full.txt is the orientation corpus inlined into one file, so a
 * reader with no filesystem access still gets the rules, the product
 * definition and every domain charter in a single fetch.
 *
 * What it does NOT inline: the generated registries (PRD-SDD, TRACE,
 * FEATURE-MAP, ROADMAP, the API and DB appendices). Together they are several
 * megabytes of machine-written tables that would drown the prose a reader
 * actually needs, and they are regenerated on every `npm run govern` — a
 * frozen copy here would be wrong within a day. They are listed by path and
 * size instead, under "Not inlined" at the end.
 *
 * The output is deterministic: no timestamps, no run ids, file lists sorted.
 * `--check` therefore means something — it fails when the committed
 * llms-full.txt no longer matches the sources, the same contract as
 * `npm run docs:check`.
 *
 *   node scripts/build-llms-full.mjs            # write llms-full.txt
 *   node scripts/build-llms-full.mjs --check    # exit 1 if it is stale
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'llms-full.txt');

/** Documents inlined in full, in reading order. */
const SECTIONS = [
  {
    title: 'Orientation',
    blurb: 'What this repository is, and the rules that govern changing it.',
    files: ['README.md', 'CLAUDE.md', 'AGENTS.md'],
  },
  {
    title: 'Product',
    blurb: 'Layer 0 — what the product is, above the per-module requirements.',
    files: ['docs/PRODUCT.md', 'docs/DOMAIN-MODEL.md', 'docs/ERP-MODULE-MAP.md'],
  },
  {
    title: 'Architecture',
    blurb: 'The target architecture and the current domain map.',
    files: ['docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md', 'docs/DOMAIN-MAP.md'],
  },
  {
    title: 'Vocabulary',
    blurb: 'Read this before guessing what a term means.',
    files: ['docs/appendices/F-glossary.md'],
  },
];

/** Every domain charter is inlined — the charter is the lane definition. */
const CHARTER_DIR = 'docs/domains';

/** Listed by title only: the ADR corpus is too much prose to inline, but the
 *  titles are the decision index a reader needs to know what has been settled. */
const ADR_DIR = 'docs/decisions';

/** Named, sized, and not inlined — see the file header for why. */
const NOT_INLINED = [
  ['docs/PRD-SDD-v1.0.md', 'the FR / NFR / BR / SEC / SDD registry — every requirement id'],
  ['docs/FEATURES.md', 'the FEAT registry'],
  ['docs/FEATURE-MAP.md', 'generated — the feature-driven view over the domain spine'],
  ['docs/TRACE.md', 'generated — per FR: surface to code to rules to tests'],
  ['docs/appendices/A-api-spec.md', 'generated — the API surface'],
  ['docs/appendices/B-db-schema.md', 'the database schema'],
  ['docs/appendices/D-traceability.md', 'generated — the traceability appendix'],
  ['docs/roadmap/ROADMAP.md', 'live delivery state (Thai) — read by GoVibe Mission Control'],
];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const kb = (p) => `${Math.round(statSync(join(ROOT, p)).size / 1024)}KB`;

/** Strip a leading YAML frontmatter block, returning it separately. Inlined
 *  mid-file it is noise; its id/version/status still matter, so they are
 *  lifted into the section header instead of thrown away. */
function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { meta: null, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { meta: null, body: text };
  return { meta: text.slice(4, end), body: text.slice(end + 4).replace(/^\n+/, '') };
}

function metaLine(meta) {
  if (!meta) return null;
  const pick = (k) => (meta.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?`, 'm')) || [])[1];
  const parts = [['id', pick('id')], ['version', pick('version')], ['status', pick('status')]]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v.trim()}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Rewrite a document's relative links to be relative to the repository root.
 *
 * Inlining moves a document out of its folder, which silently breaks every
 * relative link it carries: a charter's `../../decisions/ADR-055...` resolves
 * from `docs/domains/<d>/`, not from the root this file sits at. Resolving
 * them here is the difference between a corpus whose links work and one whose
 * links look like they work. External URLs, anchors and anything that would
 * escape the repository are left exactly as written.
 */
function rewriteLinks(body, path) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  if (!dir) return body;
  return body.replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (match, target, title = '') => {
    if (/^([a-z][a-z0-9+.-]*:|[#/])/i.test(target)) return match;
    const hash = target.indexOf('#');
    const filePart = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? '' : target.slice(hash);
    if (!filePart) return match;
    const resolved = posix.normalize(posix.join(dir, filePart));
    if (resolved.startsWith('..')) return match;
    return `](${resolved}${anchor}${title})`;
  });
}

function document(path) {
  const { meta, body: raw } = splitFrontmatter(read(path));
  const body = rewriteLinks(raw, path);
  const line = metaLine(meta);
  const rule = '='.repeat(72);
  return [
    '',
    `<!-- ${rule} -->`,
    `<!-- source: ${path}${line ? ` — ${line}` : ''} -->`,
    `<!-- ${rule} -->`,
    '',
    body.trimEnd(),
    '',
  ].join('\n');
}

function charterPaths() {
  return readdirSync(join(ROOT, CHARTER_DIR))
    .filter((d) => existsSync(join(ROOT, CHARTER_DIR, d, 'CHARTER.md')))
    .sort()
    .map((d) => `${CHARTER_DIR}/${d}/CHARTER.md`);
}

function adrIndex() {
  return readdirSync(join(ROOT, ADR_DIR))
    .filter((f) => f.startsWith('ADR-') && f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { body } = splitFrontmatter(read(`${ADR_DIR}/${f}`));
      const heading = (body.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
      return `- [${heading.trim()}](${ADR_DIR}/${f})`;
    });
}

function build() {
  const out = [];
  const charters = charterPaths();
  const inlined = [...SECTIONS.flatMap((s) => s.files), ...charters];

  out.push('# zuri-ai — full documentation corpus');
  out.push('');
  out.push('> The expanded companion to [llms.txt](llms.txt): the orientation corpus of');
  out.push('> zuri-ai inlined into one file — what the product is, the rules for changing');
  out.push('> it, the architecture, the vocabulary, and every domain charter.');
  out.push('');
  out.push('zuri-ai is an AI-native business operating system. LINE is the primary intake');
  out.push('surface; the web app is the back-office console for detail, complex edits and');
  out.push('audit. Scope chain: Portfolio → Tenant (isolation) → Business → Workspace →');
  out.push('Project. It is a standalone product (ADR-024) and shares nothing with the');
  out.push('legacy `Freshair129/zuri` project — documents written before 2026-08-16 call it');
  out.push('"Zuri V2" and a legacy project "V1", and those words are historical labels, not');
  out.push('instructions. Repository: https://github.com/Freshair129/zuri.ai');
  out.push('');
  out.push('GENERATED by `node scripts/build-llms-full.mjs` — do not hand-edit; edit the');
  out.push(`source documents instead. ${inlined.length} documents are inlined below in full,`);
  out.push('with their relative links rewritten to resolve from the repository root. The');
  out.push('large generated registries are named but not inlined; see "Not inlined" at the');
  out.push('end for what they are and where they live.');
  out.push('');
  out.push('## Contents');
  out.push('');
  for (const section of SECTIONS) {
    out.push(`- **${section.title}** — ${section.files.join(', ')}`);
  }
  out.push(`- **Domain charters** — ${charters.length} lanes, each stating what it owns and must not touch`);
  out.push('- **Decision index** — every ADR by title');
  out.push('- **Not inlined** — the generated registries, by path and size');
  out.push('');

  for (const section of SECTIONS) {
    out.push('');
    out.push(`# ${section.title}`);
    out.push('');
    out.push(section.blurb);
    for (const f of section.files) out.push(document(f));
  }

  out.push('');
  out.push('# Domain charters');
  out.push('');
  out.push('One folder per domain under `docs/domains/`, mirroring');
  out.push('`apps/server/src/modules/`. A charter states what the domain owns, its');
  out.push('boundaries and its contracts; preflight fails when a module has no charter');
  out.push('claiming it, when two charters claim one model, or when a feature note declares');
  out.push('a domain that disagrees with its folder.');
  for (const f of charters) out.push(document(f));

  out.push('');
  out.push('# Decision index');
  out.push('');
  out.push('Architecture decision records, by title. ADR-024 sets the product direction,');
  out.push('ADR-025 the domain spine, ADR-039 the id contract, ADR-062 the monorepo');
  out.push('boundary. Bodies are not inlined — follow the link for the reasoning.');
  out.push('');
  out.push(...adrIndex());

  out.push('');
  out.push('# Not inlined');
  out.push('');
  out.push('These are machine-written and regenerated by `npm run govern`; a frozen copy');
  out.push('here would be stale within a day, and together they outweigh the prose above by');
  out.push('an order of magnitude. Read them from the repository:');
  out.push('');
  for (const [path, note] of NOT_INLINED) {
    out.push(`- [${path}](${path}) (${kb(path)}): ${note}`);
  }
  out.push('');

  return out.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
}

const text = build();
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('llms-full.txt is stale — run: node scripts/build-llms-full.mjs');
    process.exit(1);
  }
  console.log(`llms-full.txt is up to date (${Math.round(text.length / 1024)}KB)`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${relative(ROOT, OUT)} (${Math.round(text.length / 1024)}KB)`);
}
