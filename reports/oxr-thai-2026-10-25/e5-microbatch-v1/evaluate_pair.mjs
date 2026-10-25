import fs from 'node:fs';
import crypto from 'node:crypto';
import { canonicalJson, canonicalQuery, samePinnedRuntime, sameResourceProfile } from './pair_contracts.mjs';

const [globalDir, batchDir, captureParityPath, outputPath] = process.argv.slice(2);
if (!globalDir || !batchDir || !captureParityPath || !outputPath) {
  throw new Error('usage: evaluate_pair.mjs global_dir batch32_dir captured_vector_parity.json output.json');
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fileSha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const resultRows = (root) => {
  const run = readJson(`${root}/native-results.json`);
  const rows = run.queries.map(canonicalQuery);
  return { run, rows };
};
const global = resultRows(globalDir);
const batch = resultRows(batchDir);
const vectorParity = readJson(captureParityPath);
const globalState = readJson(`${globalDir}/native-state.json`);
const batchState = readJson(`${batchDir}/native-state.json`);
const globalProfile = readJson(`${globalDir}/native-launch-profile.json`);
const batchProfile = readJson(`${batchDir}/native-launch-profile.json`);
const globalRuntime = readJson(`${globalDir}/runtime-provenance.json`);
const batchRuntime = readJson(`${batchDir}/runtime-provenance.json`);
const embedPath = '/opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py';
const stageTimeMs = (root) => {
  const stages = readJson(`${root}/stages.json`).steps;
  const stage = stages.find((entry) => entry.pipelineStageId === 'DPS-KI-EMBED');
  if (!stage) throw new Error(`missing DPS-KI-EMBED stage at ${root}`);
  return {
    recordedStart: stage.startedAt,
    recordedFinish: stage.finishedAt,
    elapsedMsFromTimestamps: Date.parse(stage.finishedAt) - Date.parse(stage.startedAt),
  };
};

const sameInput = global.run.inputHash === batch.run.inputHash
  && global.run.chunkCount === batch.run.chunkCount
  && global.run.chunkCount === 302;
const sameResults = global.rows.length === 48
  && batch.rows.length === 48
  && canonicalJson(global.rows) === canonicalJson(batch.rows);
const sameResources = sameResourceProfile(globalProfile.resources, batchProfile.resources);
const samePinnedRuntimeProfile = samePinnedRuntime(globalProfile, batchProfile, globalRuntime, batchRuntime);
const sameFrozenProfile = sameResources
  && globalProfile.sidecarMode === 'global'
  && globalProfile.requestedBatchSize === 0
  && batchProfile.sidecarMode === 'batch32'
  && batchProfile.requestedBatchSize === 32
  && globalProfile.arm === batchProfile.arm
  && globalProfile.candidateProfile === batchProfile.candidateProfile
  && globalProfile.pinnedImage === batchProfile.pinnedImage
  && globalProfile.readonlyModelVolume === batchProfile.readonlyModelVolume
  && globalProfile.modelDirectory === batchProfile.modelDirectory
  && globalProfile.embeddingSidecarOverrideSha256 === batchProfile.embeddingSidecarOverrideSha256
  && canonicalJson(globalProfile.codeHashes) === canonicalJson(batchProfile.codeHashes);
const runtimeHashMatches = globalRuntime.hashes[embedPath] === batchRuntime.hashes[embedPath]
  && globalRuntime.hashes[embedPath] === globalProfile.embeddingSidecarOverrideSha256
  && batchRuntime.hashes[embedPath] === batchProfile.embeddingSidecarOverrideSha256
  && canonicalJson(globalRuntime.pins) === canonicalJson(batchRuntime.pins);
const status = global.run.status === 'COMPLETED'
  && batch.run.status === 'COMPLETED'
  && global.run.successfulStages === 17
  && batch.run.successfulStages === 17
  && global.rows.length === 48
  && batch.rows.length === 48
  && globalState.ExitCode === 0
  && batchState.ExitCode === 0
  && !globalState.OOMKilled
  && !batchState.OOMKilled
  && sameInput
  && sameResources
  && samePinnedRuntimeProfile
  && sameFrozenProfile
  && sameResults
  && runtimeHashMatches
  && vectorParity.status === 'PASS';

const summary = {
  schema: 'e5-microbatch-native-pair-summary-v1',
  status: status ? 'PASS' : 'FAIL',
  sourceInput: {
    nativeInputSha256: fileSha256('.local/hyper-economy-cell-repair-20261025/native-input-economy-pdf-rows-v1.json'),
    contentHash: global.run.inputHash,
    chunkCount: global.run.chunkCount,
    sameInputAcrossArms: sameInput,
  },
  runtime: {
    pinnedImage: globalProfile.pinnedImage,
    sameResourceProfile: sameResources,
    samePinnedImageAndModelRevision: samePinnedRuntimeProfile,
    sameFrozenProfile,
    globalBatchSize: globalProfile.requestedBatchSize,
    candidateBatchSize: batchProfile.requestedBatchSize,
    helperOverrideSha256: globalRuntime.hashes[embedPath],
    helperHashEqualAcrossArms: runtimeHashMatches,
    baseImageHelperSha256: globalProfile.embeddingSidecarBaseImageSha256,
  },
  native: {
    global: {
      status: global.run.status,
      successfulStages: global.run.successfulStages,
      queryRows: global.rows.length,
      totalMs: global.run.totalMs,
      memoryPeakBytes: global.run.memoryPeakBytes,
      oomKilled: globalState.OOMKilled,
      exitCode: globalState.ExitCode,
      embedStage: stageTimeMs(globalDir),
    },
    batch32: {
      status: batch.run.status,
      successfulStages: batch.run.successfulStages,
      queryRows: batch.rows.length,
      totalMs: batch.run.totalMs,
      memoryPeakBytes: batch.run.memoryPeakBytes,
      oomKilled: batchState.OOMKilled,
      exitCode: batchState.ExitCode,
      embedStage: stageTimeMs(batchDir),
    },
    retrievalRowsExactAfterRunLocalIdNormalization: sameResults,
    exactQueryAndTopKRows: global.rows.length,
  },
  vectorParity: {
    sha256: fileSha256(captureParityPath),
    status: vectorParity.status,
    outerSidecarRequests: vectorParity.requestSequence.globalRequestCount,
    orderedRequestSignaturesEqual: vectorParity.requestSequence.sequenceMatches,
    queryVectorCount: vectorParity.requestSequence.queryVectorCount,
    passage: vectorParity.modes.passage,
    query: vectorParity.modes.query,
    rawTextStored: vectorParity.rawTextStored,
  },
  claims: {
    embeddingBatchControlOnly: true,
    nativeInputChanged: false,
    modelRevisionChanged: false,
    queryOrGoldUsedToSelectBatchSize: false,
    productionChanged: false,
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  status: summary.status,
  globalTotalMs: summary.native.global.totalMs,
  batch32TotalMs: summary.native.batch32.totalMs,
  globalEmbedMs: summary.native.global.embedStage.elapsedMsFromTimestamps,
  batch32EmbedMs: summary.native.batch32.embedStage.elapsedMsFromTimestamps,
  globalPeakBytes: summary.native.global.memoryPeakBytes,
  batch32PeakBytes: summary.native.batch32.memoryPeakBytes,
  exactResultRows: summary.native.exactQueryAndTopKRows,
  outerRequests: summary.vectorParity.outerSidecarRequests,
  queryVectors: summary.vectorParity.queryVectorCount,
  vectorParity: summary.vectorParity.status,
}, null, 2));
if (!status) process.exitCode = 1;
