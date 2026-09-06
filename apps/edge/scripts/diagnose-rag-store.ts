// Operator diagnostic for the v4 store: proves whether the vectors in the store actually
// correspond to the nodes they are attached to, and shows what a query really retrieves.
//
// The decisive check is self-retrieval: re-embed one passage exactly as ingest embedded it and
// ask the store for its nearest neighbour. A correctly built store must return that same node
// with a near-perfect score. When it does not, the store is misaligned and no amount of query
// tuning will fix it — reingest is the answer.
//
// Usage: npm run rag:diagnose -- [query]
import fs from 'node:fs';
import path from 'node:path';

import { buildGraphV4, embeddableNodes } from '../src/rag/v4/build-graph.js';
import { readFlowAccountXlsx, parseFlowAccountRows } from '../src/rag/v4/flowaccount.js';
import { resolvePipelinePaths } from '../src/rag/v4/paths.js';
import { loadGenesisDatabase } from '../src/rag/v4/genesis-binding.js';
import { createEmbedClient } from '../src/rag/v4/embed-client.js';
import { COLLECTION, VECTOR_DIM } from '../src/rag/v4/schema.js';

const QUERY = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'แก้วน้ำ';

const label = (props: any): string =>
  String(props?.displayName ?? props?.name_th ?? props?.name_en ?? props?.code ?? '').slice(0, 46);

async function main(): Promise<void> {
  const p = resolvePipelinePaths();
  const embed = createEmbedClient(process.env.EMBED_URL ?? 'http://127.0.0.1:8891', { timeoutMs: 120000 });

  const identity = JSON.parse(fs.readFileSync(p.identity, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(p.catalog, 'utf8'));
  const categoryMap = JSON.parse(fs.readFileSync(p.categoryMap, 'utf8'));
  const aliases = JSON.parse(fs.readFileSync(p.aliases, 'utf8'));
  const flowaccount = parseFlowAccountRows(await readFlowAccountXlsx(p.flowaccount));
  const ref = { file: '-', sha256: '-', rowKey: '' };
  const batch = buildGraphV4({
    identity,
    catalog,
    flowaccount,
    categoryMap,
    aliases,
    refs: { identity: ref, catalog: ref, flowaccount: ref },
  });
  const passages = embeddableNodes(batch);

  const runId = fs.readFileSync(path.join(p.storeRoot, 'CURRENT'), 'utf8').trim();
  const storePath = path.join(p.storeRoot, runId);
  const db = loadGenesisDatabase().open({
    path: storePath,
    vectorDim: VECTOR_DIM,
    retention: 'frontier_only',
    readOnly: true,
  });

  console.log(`store   : ${storePath}`);
  console.log(`passages: ${passages.length} rebuilt from the same inputs`);
  console.log(`vectors : ${JSON.stringify(db.listCollections().find((c: any) => c.name === COLLECTION))}`);

  // --- self-retrieval on three passages spread across the corpus ------------------------------
  const samples = [passages[0], passages[Math.floor(passages.length / 2)], passages[passages.length - 1]].filter(Boolean);
  const selfVecs = await embed.embed(samples.map((s) => s.text), 'passage');
  console.log('\n--- self-retrieval (each passage must find itself first) ---');
  let aligned = 0;
  for (let i = 0; i < samples.length; i++) {
    const hits = await db.hybridSearch({ queryVector: selfVecs[i], k: 3, alpha: 0, collection: COLLECTION });
    const top = hits[0];
    const ok = top?.node?.id === samples[i].id;
    if (ok) aligned += 1;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} want=${samples[i].id}`);
    console.log(`       got =${top?.node?.id} score=${top?.score?.toFixed(4)} (${label(top?.node?.props)})`);
  }
  console.log(`  aligned ${aligned}/${samples.length}`);

  // --- what the query actually retrieves -------------------------------------------------------
  const [qv] = await embed.embed([`query: ${QUERY}`], 'query');
  const hits = await db.hybridSearch({ queryVector: qv, k: 8, alpha: 0, collection: COLLECTION });
  console.log(`\n--- query "${QUERY}" (raw engine scores, no post-filtering) ---`);
  for (const h of hits) {
    const passage = passages.find((n) => n.id === h.node.id);
    console.log(`  ${h.score?.toFixed(4)} ${h.node.id}`);
    console.log(`         ${passage ? passage.text.slice(0, 110) : '(no rebuilt passage — node not embeddable?)'}`);
  }

  if (aligned !== samples.length) {
    console.error('\nDIAGNOSIS: vectors are NOT aligned with their nodes. Reingest required.');
    process.exit(1);
  }
  console.log('\nDIAGNOSIS: vectors are aligned with their nodes; retrieval reflects the embedding model.');
}

main().catch((err) => {
  console.error('[rag-diagnose]', err);
  process.exit(3);
});
