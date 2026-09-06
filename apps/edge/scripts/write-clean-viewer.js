import fs from 'fs';

const srcPath = 'D:/workspace/Bussiness-01-SmartGift/data/graph-viewer/index.html';
const destPath = 'D:/workspace/zuri-edge-llm/graph-viewer.html';

let html = fs.readFileSync(srcPath, 'utf8');

// Replace topbar buttons using exact pattern match
const oldBtnStr = '<button class="btn" id="fitBtn">Fit view</button>';
const newBtnStr = `<button class="btn" id="exportJsonBtn" style="border-color:#2f7fd6;color:#2f7fd6;font-weight:700">💾 Export JSON</button>
      <button class="btn" id="exportHtmlBtn" style="border-color:#2e8b3d;color:#2e8b3d;font-weight:700">📦 Download HTML</button>
      <button class="btn" id="fitBtn">Fit view</button>`;

html = html.replace(oldBtnStr, newBtnStr);

// Split at script
const scriptSplit = html.split('<script>');
const htmlHead = scriptSplit[0] + '<script>\n';

const jsLogicFull = scriptSplit[1];
const simIndex = jsLogicFull.indexOf('  // ---------- sim state ----------');
const logicTail = jsLogicFull.slice(simIndex);

const liveLoaderAndIndex = `
let GRAPH_DATA = { nodes: [], edges: [], label_counts: {} };

async function initLiveGraph() {
  try {
    const res = await fetch('/api/graph');
    if (res.ok) {
      const data = await res.json();
      if (data && data.nodes && data.nodes.length > 0) {
        GRAPH_DATA = {
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
        GRAPH_DATA.nodes.forEach(n => {
          GRAPH_DATA.label_counts[n.label] = (GRAPH_DATA.label_counts[n.label] || 0) + 1;
        });
      }
    }
  } catch (err) {
    console.error('Error fetching /api/graph from GenesisBlock DB:', err);
  }
}

(async function(){
  "use strict";

  await initLiveGraph();

  const LABEL_COLORS = {
    Customer:'--c-Customer', Document:'--c-Document', Product:'--c-Product', CatalogSource:'--c-CatalogSource',
    Brand:'--c-Brand', Competitor:'--c-Competitor', Org:'--c-Org', KnowledgeChunk:'--c-KnowledgeChunk',
    Category:'--c-CatalogSource'
  };
  const DEFAULT_ON = new Set(['Org','Brand','Competitor','Customer','CatalogSource','KnowledgeChunk','Product','Category']);
  const MAX_SIM_NODES = 700;

  function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function colorFor(node){
    if(node.status === 'candidate') return cssVar('--c-candidate');
    const v = LABEL_COLORS[node.label];
    return v ? cssVar(v) : cssVar('--c-Product');
  }

  // ---------- index the data ----------
  const nodesById = new Map();
  GRAPH_DATA.nodes.forEach(n => nodesById.set(n.id, n));
  const adjacency = new Map(); // id -> [{edge, otherId, dir}]
  GRAPH_DATA.nodes.forEach(n => adjacency.set(n.id, []));
  GRAPH_DATA.edges.forEach(e => {
    if(!nodesById.has(e.source) || !nodesById.has(e.target)) return;
    adjacency.get(e.source).push({edge:e, otherId:e.target, dir:'out'});
    adjacency.get(e.target).push({edge:e, otherId:e.source, dir:'in'});
  });

  const labelCounts = GRAPH_DATA.label_counts || {};
  const allLabels = Object.keys(labelCounts).sort((a,b)=> (labelCounts[b]-labelCounts[a]));
  const activeLabels = new Set(allLabels.filter(l => DEFAULT_ON.has(l)));
`;

const handlers = `
  // ---------- export & download handlers ----------
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(GRAPH_DATA, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smartgift-genesisblock-graph.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('exportHtmlBtn').addEventListener('click', () => {
    const standaloneHtml = '<!doctype html>\\n' + document.documentElement.outerHTML;
    const blob = new Blob([standaloneHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smartgift-knowledge-graph-offline.html';
    a.click();
    URL.revokeObjectURL(url);
  });
`;

const finalLogicTail = logicTail.replace('  // ---------- boot ----------', handlers + '\n  // ---------- boot ----------');

const fullOutput = htmlHead + liveLoaderAndIndex + '\n' + finalLogicTail;

fs.writeFileSync(destPath, fullOutput, 'utf8');
console.log('✅ Generated clean graph-viewer.html with visible Download buttons!');
