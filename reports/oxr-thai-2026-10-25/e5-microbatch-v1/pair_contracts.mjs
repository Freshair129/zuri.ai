import crypto from 'node:crypto';

export function canonicalJson(value) {
  const sortKeys = (item) => Array.isArray(item)
    ? item.map(sortKeys)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sortKeys(item[key])]))
      : item;
  return JSON.stringify(sortKeys(value));
}

export function canonicalQuery(query) {
  if (typeof query.id !== 'string' || typeof query.doc !== 'string' || !Number.isInteger(query.repetition)) {
    throw new Error('native query row is missing stable ID/document/repetition');
  }
  if (!Array.isArray(query.response?.results)) throw new Error('native query row has no results array');
  return {
    id: query.id,
    doc: query.doc,
    repetition: query.repetition,
    ranked: query.response.results.map((result) => {
      const citation = result.citation ?? {};
      const chunkMatch = typeof citation.chunkId === 'string' && citation.chunkId.match(/:chunk:(\d+)$/);
      if (!chunkMatch || typeof citation.sourceId !== 'string' || typeof result.document !== 'string') {
        throw new Error('native result is missing stable source/chunk/document identity');
      }
      if (!Array.isArray(result.zoneIds) || result.zoneIds.some((zoneId) => typeof zoneId !== 'string')) {
        throw new Error('native result is missing stable zone identity');
      }
      const range = result.verifiedRange;
      if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end <= range.start) {
        throw new Error('native result is missing a valid verified range');
      }
      if (!Number.isFinite(result.score) || typeof result.text !== 'string') {
        throw new Error('native result is missing finite score or returned text');
      }
      return {
        score: result.score,
        document: result.document,
        zoneIds: result.zoneIds,
        sourceId: citation.sourceId,
        chunkOrdinal: Number(chunkMatch[1]),
        contentHash: typeof citation.contentHash === 'string' ? citation.contentHash : null,
        returnedTextSha256: crypto.createHash('sha256').update(result.text, 'utf8').digest('hex'),
        verifiedRange: { start: range.start, end: range.end },
      };
    }),
  };
}

export function sameResourceProfile(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function samePinnedRuntime(leftProfile, rightProfile, leftRuntime, rightRuntime) {
  const leftModel = leftRuntime?.pins?.runtime;
  const rightModel = rightRuntime?.pins?.runtime;
  return Boolean(
    leftProfile?.pinnedImage
      && leftProfile.pinnedImage === rightProfile?.pinnedImage
      && leftProfile.readonlyModelVolume
      && leftProfile.readonlyModelVolume === rightProfile?.readonlyModelVolume
      && leftProfile.modelDirectory
      && leftProfile.modelDirectory === rightProfile?.modelDirectory
      && leftModel?.modelRepository
      && leftModel.modelRepository === rightModel?.modelRepository
      && leftModel.modelRevision
      && leftModel.modelRevision === rightModel?.modelRevision
      && canonicalJson(leftRuntime.pins) === canonicalJson(rightRuntime?.pins),
  );
}
