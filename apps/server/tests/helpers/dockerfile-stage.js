/**
 * Slice one named stage out of a Dockerfile.
 *
 * The runtime-image guards (server-line-worker-cadence, server-retention-sweep-worker-script,
 * ki17-build-stage) all ask the same question: "does the stage that ships this file
 * actually copy it?" They used to find that stage with `lastIndexOf('\nFROM ')`,
 * which worked only while `runner` happened to be the last stage in the file.
 *
 * ADR-075 Phase 3 added the opt-in ki17 targets after it, and the proxy silently
 * started pointing at `genesis-worker` — so two guards that exist to catch a missing
 * COPY began reading a stage that was never supposed to contain one. They failed
 * loudly, which is the only reason this is a footnote rather than an incident. Ask
 * for the stage by name instead: a name cannot drift when a stage is appended.
 */
export function dockerfileStage(dockerfile, name) {
  const header = new RegExp(`^FROM [^\\n]* AS ${name}\\s*$`, 'm')
  const match = header.exec(dockerfile)
  if (!match) throw new Error(`Dockerfile has no stage named ${name}`)
  const start = match.index
  const next = dockerfile.slice(start + match[0].length).search(/^FROM /m)
  return next === -1 ? dockerfile.slice(start) : dockerfile.slice(start, start + match[0].length + next)
}

/** The production web image: the stage docker-compose.yml and CI both name. */
export const runnerStage = (dockerfile) => dockerfileStage(dockerfile, 'runner')
