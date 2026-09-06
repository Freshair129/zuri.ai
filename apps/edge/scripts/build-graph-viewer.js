import fs from 'fs';
import path from 'path';

const srcPath = 'D:/workspace/Bussiness-01-SmartGift/data/graph-viewer/index.html';
const destPath = 'D:/workspace/zuri-edge-llm/graph-viewer.html';

let html = fs.readFileSync(srcPath, 'utf8');

// Replace static embedded large JSON with dynamic fetch loader
const dataMarkerStart = 'const GRAPH_DATA = {';
const dataMarkerEnd = 'const LABEL_COLORS = {';

const startIndex = html.indexOf(dataMarkerStart);
const endIndex = html.indexOf(dataMarkerEnd);

if (startIndex !== -1 && endIndex !== -1) {
  const dynamicScript = `
let GRAPH_DATA = { nodes: [], edges: [], label_counts: {} };

async function fetchLiveGenesisGraph() {
  try {
    const res = await fetch('/api/graph');
    if (res.ok) {
      const data = await res.json();
      if (data && data.nodes && data.nodes.length > 0) {
        return {
          nodes: data.nodes.map(n => ({
            id: String(n.id || n.name),
            label: n.label || 'Product',
            name: n.name || n.id,
            status: n.status || 'canonical',
            props: n.props || {}
          })),
          edges: (data.edges || []).map(e => ({
            source: String(e.from || e.source),
            target: String(e.to || e.target),
            type: e.type || e.rel || 'CONNECTED_TO',
            props: e.props || {}
          })),
          label_counts: {}
        };
      }
    }
  } catch (err) {
    console.warn('Fallback to local snapshot graph', err);
  }
  return null;
}

`;
  html = html.slice(0, startIndex) + dynamicScript + html.slice(endIndex);
}

// Update the boot sequence to await live graph
html = html.replace(
  '  // ---------- boot ----------\n  renderLegend();\n  resize();\n  rebuildSim(false);',
  `  // ---------- boot (Live GenesisBlock DB) ----------
  const liveData = await fetchLiveGenesisGraph();
  if (liveData) {
    GRAPH_DATA = liveData;
    GRAPH_DATA.nodes.forEach(n => {
      GRAPH_DATA.label_counts[n.label] = (GRAPH_DATA.label_counts[n.label] || 0) + 1;
    });
    nodesById.clear();
    adjacency.clear();
    GRAPH_DATA.nodes.forEach(n => nodesById.set(n.id, n));
    GRAPH_DATA.nodes.forEach(n => adjacency.set(n.id, []));
    GRAPH_DATA.edges.forEach(e => {
      if (!nodesById.has(e.source) || !nodesById.has(e.target)) return;
      adjacency.get(e.source).push({ edge: e, otherId: e.target, dir: 'out' });
      adjacency.get(e.target).push({ edge: e, otherId: e.source, dir: 'in' });
    });
  }
  renderLegend();
  resize();
  rebuildSim(false);`
);

// Wrap IIFE with async
html = html.replace('(function(){\n  "use strict";', '(async function(){\n  "use strict";');

fs.writeFileSync(destPath, html, 'utf8');
console.log('✅ Successfully created dynamic graph-viewer.html that queries live GenesisBlock DB!');
