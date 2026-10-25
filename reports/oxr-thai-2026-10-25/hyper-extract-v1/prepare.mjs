import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const inputPath = '.local/thai-table-chunking-20261025/run-v2/native-input.json';
const sidecarPath = '.local/thai-table-chunking-20261025/run-v2/table-sidecar.json';
const runDir = '.local/hyper-extract-20261025/run-2';
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function exactRange(content, range) {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start) {
    throw new Error(`Invalid source range ${range.id}`);
  }
  const text = content.slice(range.start, range.end);
  if (sha256(text) !== range.textSha256) throw new Error(`Frozen range hash mismatch: ${range.id}`);
  return text;
}

function sectionZones(range, rangeText, packets) {
  const headingRe = /^## ([^\r\n]+)$/gm;
  const headings = [...rangeText.matchAll(headingRe)];
  return headings.map((match, index) => {
    const localStart = match.index;
    const localEnd = headings[index + 1]?.index ?? rangeText.length;
    const section = rangeText.slice(localStart, localEnd);
    const label = match[1];
    const prose = label.match(/^(.+) prose (\d+)$/);
    const absoluteStart = range.start + localStart;
    const absoluteEnd = range.start + localEnd;
    const matchingPackets = packets.filter((p) => p.start >= absoluteStart && p.end <= absoluteEnd);
    if (matchingPackets.length > 1) throw new Error(`Multiple table packets map to ${range.id}/${label}`);
    const packet = matchingPackets[0];
    let body;
    if (packet) {
      const offsetInSection = section.indexOf(packet.text);
      if (offsetInSection < 0 || section.indexOf(packet.text, offsetInSection + 1) >= 0) {
        throw new Error(`Packet text does not uniquely map to section ${range.id}/${label}`);
      }
      if (sha256(packet.text) !== packet.textSha256) throw new Error(`Packet hash mismatch: ${label}`);
      const expectedAbsoluteStart = absoluteStart + offsetInSection;
      const expectedAbsoluteEnd = expectedAbsoluteStart + packet.text.length;
      if (packet.start !== expectedAbsoluteStart || packet.end !== expectedAbsoluteEnd) {
        throw new Error(`Packet absolute offsets mismatch: ${range.id}/${label}`);
      }
      body = packet.rowText;
    } else {
      body = section.slice(section.indexOf('\n') + 1).trimEnd();
    }
    return {
      id: `${range.id}:${label}`,
      kind: packet ? 'table-row' : prose ? 'prose' : 'source-section',
      rangeId: range.id,
      rangeSourceStart: range.start,
      sourceStart: absoluteStart,
      sourceEnd: absoluteEnd,
      text: section,
      anchorText: body,
      relationText: packet ? packet.text : body,
      packet: packet ? {
        tableId: packet.tableId,
        page: packet.page,
        row: packet.row,
        sourceHeadingLabel: label,
        textSha256: packet.textSha256,
        headerRefs: packet.headerRefs,
        cellRefs: packet.cellRefs,
        bindings: packet.bindings,
      } : null,
    };
  });
}

export function buildBundle(input, sidecar, inputHash, sidecarHash) {
  const arm = input.arms.find((candidate) => candidate.parser === 'table');
  if (!arm) throw new Error('Frozen table arm missing');
  if (sha256(arm.content) !== arm.contentSha256) throw new Error('Frozen table arm content hash mismatch');
  if (sidecar.profile !== 'ocr-table-row-v1') throw new Error(`Unexpected table profile: ${sidecar.profile}`);
  if (!Array.isArray(arm.ranges) || arm.ranges.length !== 2) throw new Error('Expected the two frozen PDF source ranges');

  const sourceRanges = arm.ranges.map((range) => ({
    id: range.id,
    pdfSha256: range.pdfSha256,
    sourceStart: range.start,
    sourceEnd: range.end,
    text: exactRange(arm.content, range),
    textSha256: range.textSha256,
  }));
  const zones = sourceRanges.flatMap((sourceRange) => {
    const range = arm.ranges.find((item) => item.id === sourceRange.id);
    const packets = sidecar.packets.filter((p) => p.doc === sourceRange.id);
    return sectionZones(range, sourceRange.text, packets);
  });
  for (const zone of zones) {
    if (zone.sourceStart < 0 || zone.sourceEnd > arm.content.length || zone.sourceEnd <= zone.sourceStart) {
      throw new Error(`Invalid source zone offsets: ${zone.id}`);
    }
    const exact = arm.content.slice(zone.sourceStart, zone.sourceEnd);
    if (exact !== zone.text) throw new Error(`Zone is not an exact source slice: ${zone.id}`);
  }

  return {
    schema: 'zuri.hyper-extract-source-bundle.v1',
    inputPath,
    inputSha256: inputHash,
    sidecarPath,
    sidecarSha256: sidecarHash,
    parser: arm.parser,
    profile: sidecar.profile,
    armContentSha256: arm.contentSha256,
    excludedControlPrefix: {
      chars: arm.ranges[0].start,
      sha256: sha256(arm.content.slice(0, arm.ranges[0].start)),
      sentToExtractor: false,
    },
    sourceRanges,
    zones,
    sourceChars: sourceRanges.reduce((sum, range) => sum + range.text.length, 0),
    zoneCount: zones.length,
    packetCount: sidecar.packets.length,
  };
}

const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
const bundle = buildBundle(input, sidecar, sha256File(inputPath), sha256File(sidecarPath));
const freeze = {
  schema: 'zuri.hyper-extract-evidence-projection-freeze.v1',
  sourceBundleSha256: sha256(JSON.stringify(bundle)),
  package: {
    name: 'hyperextract',
    version: '0.10.5',
    gitCommit: 'a8e27199ffd3984042e870d0b6963810a0d70f5d',
  },
  inference: {
    provider: 'local Ollama OpenAI-compatible chat endpoint',
    modelTag: 'qwen3.5:9b',
    modelDigest: 'bb0c43f2ae93339a21a67576441645ad0fd5696a259c250bfe4af7462c528cb2',
    chunkSizeChars: 2048,
    chunkOverlapChars: 256,
    maxWorkers: 1,
    temperature: 0,
    maxOutputTokens: 512,
    perCallTimeoutSeconds: 120,
    maxRetries: 0,
    reasoningEffortRequest: 'none',
    contextSize: 'use observed Ollama runtime; OpenAI-compatible request does not set context',
  },
  selectionPolicy: {
    input: 'only the two exact source ranges identified in the frozen table arm',
    excluded: 'control-prefix text, gold, and QA questions are not passed to Hyper-Extract',
    zones: 'exact heading-delimited source slices; table row candidates use frozen rowText for mention anchors and retain full table packet/header text as the evidence zone',
  },
  validationPolicy: {
    nodes: 'literal candidate name substring in one zone anchorText; no normalization; node descriptions are never promoted and remain unvalidated candidate claims',
    edges: 'all participants must be literal substrings of the same zone anchorText AND the complete candidate edge description must be a literal substring of that same zone relationText; otherwise HOLD; no co-occurrence inference',
  },
  projectionPolicy: {
    select: 'union of exact zones with at least one literal entity mention anchor or exact-quote relation candidate',
    content: 'verbatim source zone slices joined with a fixed blank-line delimiter; no model-generated fields enter the TEXT projection',
    nativeBoundary: 'candidate graph remains a sidecar; only the source-text projection enters unchanged GenesisRAG17 TEXT ingestion',
  },
};

fs.mkdirSync(runDir, { recursive: true });
for (const [name, value] of [['source-bundle.json', bundle], ['freeze.json', freeze]]) {
  const destination = path.join(runDir, name);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') !== serialized) {
    throw new Error(`Refusing to overwrite frozen artifact: ${destination}`);
  }
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, serialized, { flag: 'wx' });
}
console.log(JSON.stringify({ runDir, bundleSha256: freeze.sourceBundleSha256, sourceChars: bundle.sourceChars, zones: bundle.zoneCount, packets: bundle.packetCount, sourceRanges: bundle.sourceRanges.map(({ id, sourceStart, sourceEnd, textSha256 }) => ({ id, sourceStart, sourceEnd, textSha256 })) }, null, 2));
