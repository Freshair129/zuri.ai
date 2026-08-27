// @req FR-116 — derived-object provenance and the lineage chain back to a source
// @spec SDD-064, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §8 — no unattributed publication
// @tested tests/unit/knowledge-provenance.test.js

/** The declarations §8 accepts in place of a raw source. */
export const DERIVATION_METHODS = ['DERIVED', 'INFERRED', 'COMPUTED']

/**
 * The §8 invariant: nothing publishes that cannot say where it came from.
 *
 * The specification allows an object to be published without a traceable raw
 * source when it is "explicitly declared DERIVED / INFERRED / COMPUTED". Read
 * naively that is an escape hatch — type the word and the requirement lifts —
 * and an escape hatch is what every laundering pattern in this repository has
 * turned out to be.
 *
 * So the declaration is treated as a CLAIM. It exempts an object from having a
 * raw source; it never exempts it from having sources. An object that declares
 * itself derived and can name nothing it derived from is not derived, it is
 * unattributed, and it does not publish.
 */
export function assertPublishable(object, resolve) {
  if (typeof resolve !== 'function') {
    throw new Error(
      'assertPublishable requires a resolver: whether a named source EXISTS is the question, and a shape-only mode would answer a different one',
    )
  }

  const provenance = object?.provenance
  if (!provenance) {
    throw new Error(`${object?.id ?? '<unidentified>'} has no provenance and cannot be published`)
  }

  // Came from a source: the chain terminates here — which is exactly why it gets
  // checked rather than trusted. Enforcing "naming is not having" on derived
  // links and waiving it on the raw one would leave the only link that ends the
  // chain as the one link taken on faith.
  if (provenance.source_id) {
    buildSourceProvenance(provenance)
    return object
  }

  const method = provenance.derivation_method
  if (!DERIVATION_METHODS.includes(method)) {
    throw new Error(
      `${object.id} names no source and declares no derivation; it is unattributed, and §8 does not publish unattributed knowledge`,
    )
  }

  const sources = provenance.source_objects
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(
      `${object.id} declares ${method} but names no source_objects; the declaration exempts it from a raw source, not from having sources`,
    )
  }

  // Naming a source is not having one. A check that accepts an unresolvable name
  // lets the declaration back itself, which is the laundering this decision
  // exists to stop — arriving through the door the decision built.
  const missing = sources.filter((id) => !resolve(id))
  if (missing.length) {
    throw new Error(
      `${object.id} declares ${method} from ${missing.join(', ')}, which nothing resolves; a named source that does not exist is not a source`,
    )
  }

  return object
}

/** The ten fields §8 requires of every object that came from a source. */
const SOURCE_FIELDS = Object.freeze([
  'source_id',
  'source_type',
  'source_uri',
  'source_version',
  'artifact_id',
  'ingested_at',
  'parsed_at',
  'pipeline_version',
  'extractor_version',
  'checksum',
])

/**
 * Builds and validates the provenance of an object that came from a source.
 *
 * No defaults, for the reason FR-111 gives about classification: a default here
 * is a fact asserted about an artifact nobody looked at. And an empty object is
 * refused explicitly — the whole failure mode this stage exists against is a
 * `provenance` field being PRESENT and meaning nothing, which is what the three
 * stages upstream have been passing around.
 */
export function buildSourceProvenance(input = {}) {
  for (const field of SOURCE_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      throw new Error(`source provenance requires ${field}`)
    }
  }

  // An artifact cannot be parsed before it arrived. This is cheap to check and
  // it catches a clock or a copy-paste that would otherwise put a lie in a
  // lineage record nobody re-reads.
  // Parse before comparing. Date.parse('yesterday') is NaN and NaN < NaN is
  // false, so an unchecked comparison lets any garbage through the ordering
  // rule while looking like it enforced one.
  const ingested = Date.parse(input.ingested_at)
  const parsed = Date.parse(input.parsed_at)
  if (Number.isNaN(ingested)) throw new Error(`ingested_at is not a date: ${JSON.stringify(input.ingested_at)}`)
  if (Number.isNaN(parsed)) throw new Error(`parsed_at is not a date: ${JSON.stringify(input.parsed_at)}`)
  if (parsed < ingested) {
    throw new Error('parsed_at is before ingested_at; that order cannot have happened')
  }

  return Object.freeze(Object.fromEntries(SOURCE_FIELDS.map((field) => [field, input[field]])))
}

/**
 * Walks the §8 chain — Fact to Chunk to ParsedArtifact to RawArtifact to Source —
 * and says plainly whether it arrived.
 *
 * It reports rather than throws, because "this cannot be traced" is an answer a
 * caller needs to act on, not an exception to swallow. A link nothing resolves
 * is named in `unresolved`; a chain that points at itself terminates instead of
 * hanging, because a cycle is a broken chain and not a reason to stop responding.
 */
export function traceToSource(object, resolve) {
  if (typeof resolve !== 'function') {
    throw new Error('traceToSource requires a resolver; it reports on a chain it can follow, and without one there is no chain')
  }

  const path = []
  const unresolved = []
  const seen = new Set()

  const walk = (node) => {
    if (!node || seen.has(node.id)) return null
    seen.add(node.id)
    path.push(node.id)

    const provenance = node.provenance || {}
    if (provenance.source_id) return provenance.source_id

    // Every parent, not only the first. A fan-in object whose first parent is a
    // dead end is still attributable through another, and reporting `reached`
    // off one branch would answer about the branch rather than the object.
    for (const id of provenance.source_objects || []) {
      const next = resolve(id)
      if (!next) {
        unresolved.push(id)
        continue
      }
      const found = walk(next)
      if (found) return found
    }
    return null
  }

  const sourceId = walk(object)
  return sourceId
    ? { reached: true, path, unresolved, source_id: sourceId }
    : { reached: false, path, unresolved }
}
