param([switch]$PreflightOnly)
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$runDir = (Resolve-Path -LiteralPath '.local/hyper-fact-audit-20261025').Path
$inferenceDir = (Resolve-Path -LiteralPath '.local/hyper-relation-audit-20261025/run-5').Path
$validatorDir = (Resolve-Path -LiteralPath '.local/hyper-relation-audit-20261025/run-5-validator-v6').Path
$bench = $runDir
$harness = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-extract-v1').Path
$launcher = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/launch-native-v6.mjs').Path
$previous = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native').Path
$image = 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'
$inputBasePath = (Resolve-Path -LiteralPath '.local/thai-table-chunking-20261025/run-v2/native-input.json').Path
$nativeInputPath = (Resolve-Path -LiteralPath (Join-Path $runDir 'native-input-geometry-v1.json')).Path
$freezePath = Join-Path $runDir 'fact-audit-freeze.json'
$candidatePath = Join-Path $inferenceDir 'evidence-candidates.json'
$sourceBundlePath = Join-Path $inferenceDir 'source-bundle.json'
$validationPath = Join-Path $runDir 'validated-evidence-geometry-v1.json'
$projectionPath = Join-Path $runDir 'source-projection-geometry-v1.json'
$mechanicalPath = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/mechanical-audit.json').Path
$out = Join-Path $bench 'native-attempt-1'
$armName = 'hyper-fact-geometry-v1'
$containerName = 'zuri-thai-hyper-fact-audit-v1-attempt-1'

foreach ($required in @($freezePath, $candidatePath, $sourceBundlePath, $validationPath, $projectionPath, $nativeInputPath, $inputBasePath, $mechanicalPath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing frozen fact-audit artifact: $required" }
}
if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite $out" }

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-Utf8Sha256([string]$Text) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToHexString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant() }
  finally { $hasher.Dispose() }
}
function Get-JsonObjectSha256([string]$Path) {
  $script = 'const fs=require("fs"),crypto=require("crypto");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(crypto.createHash("sha256").update(JSON.stringify(value),"utf8").digest("hex"));'
  $result = & node -e $script $Path
  if ($LASTEXITCODE -ne 0) { throw "Could not parse and hash source bundle object: $Path" }
  return ([string]$result).Trim()
}

$freeze = Get-Content -LiteralPath $freezePath -Raw | ConvertFrom-Json
$candidate = Get-Content -LiteralPath $candidatePath -Raw | ConvertFrom-Json
$sourceBundle = Get-Content -LiteralPath $sourceBundlePath -Raw | ConvertFrom-Json
$validation = Get-Content -LiteralPath $validationPath -Raw | ConvertFrom-Json
$projection = Get-Content -LiteralPath $projectionPath -Raw | ConvertFrom-Json
$nativeInput = Get-Content -LiteralPath $nativeInputPath -Raw | ConvertFrom-Json
$baseInput = Get-Content -LiteralPath $inputBasePath -Raw | ConvertFrom-Json

$inputPathMap = @{
  run5Freeze = Join-Path $inferenceDir 'freeze.json'
  candidateReceipt = $candidatePath
  chunks = Join-Path $inferenceDir 'chunks.json'
  sourceBundle = $sourceBundlePath
  v6ValidationBaseline = Join-Path $validatorDir 'validated-evidence.json'
  tableSidecar = (Resolve-Path -LiteralPath '.local/thai-table-chunking-20261025/run-v2/table-sidecar.json').Path
  economyPaddleRaw = (Resolve-Path -LiteralPath '.local/thai-native-20261025/paddle-2/economy.json').Path
  populationPaddleRaw = (Resolve-Path -LiteralPath '.local/thai-native-20261025/paddle-2/population.json').Path
  sourceEconomyPdf = (Resolve-Path -LiteralPath '.local/thai-native-20261025/input/economy.pdf').Path
  sourcePopulationPdf = (Resolve-Path -LiteralPath '.local/thai-native-20261025/input/population.pdf').Path
  baselineNativeInput = $inputBasePath
  v6NativeInputPrefixSource = Join-Path $validatorDir 'native-input.json'
}
$codePathMap = @{
  geometryResolver = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/geometry_binding.py'
  geometryTests = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/test_geometry_binding.py'
  nativeContractTests = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/test_native_contract.py'
  revalidator = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/revalidate_facts.py'
  projectionBuilder = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/build_projection.py'
  nativeInputBuilder = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/build_native_input.py'
  freezeWriter = 'reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/freeze_fact_audit.py'
  nativeRunner = $PSCommandPath
  nativeLauncher = $launcher
  nativeTest = 'reports/oxr-thai-2026-10-25/hyper-extract-v1/native.test.js'
  nativeTestConfig = 'reports/oxr-thai-2026-10-25/real-native/native.config.mjs'
  nativeMetrics = 'reports/oxr-thai-2026-10-25/real-native/metrics.mjs'
  goldManifest = 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json'
}

foreach ($key in $inputPathMap.Keys) {
  if ($freeze.inputFiles.$key -ne (Get-FileSha256 $inputPathMap[$key])) { throw "Frozen input changed: $key" }
}
foreach ($key in $codePathMap.Keys) {
  $codePath = $codePathMap[$key]
  if (-not [System.IO.Path]::IsPathRooted([string]$codePath)) { $codePath = Join-Path $repo $codePath }
  if ($freeze.codeFiles.$key -ne (Get-FileSha256 $codePath)) { throw "Frozen source code changed: $key" }
}

if ($candidate.runId -ne 'run-5' -or $candidate.status -ne 'COMPLETED') { throw 'Native run requires the one frozen completed run-5 receipt' }
if ($freeze.extractionFreezeSha256 -ne (Get-FileSha256 (Join-Path $inferenceDir 'freeze.json')) -or $candidate.freezeSha256 -ne $freeze.extractionFreezeSha256) { throw 'Run-5 extraction freeze mismatch' }
if ($freeze.candidateReceiptSha256 -ne (Get-FileSha256 $candidatePath)) { throw 'Candidate receipt differs from fact-audit freeze' }
if ($freeze.sourceBundleFileSha256 -ne (Get-FileSha256 $sourceBundlePath)) { throw 'Source bundle file differs from fact-audit freeze' }
if ($candidate.sourceBundleSha256 -ne $freeze.sourceBundleContentSha256) { throw 'Candidate source bundle content hash differs from fact-audit freeze' }
if ($candidate.sourceBundleSha256 -ne (Get-JsonObjectSha256 $sourceBundlePath)) { throw 'Source bundle object hash differs from candidate receipt' }
if ($freeze.validationFileSha256 -ne (Get-FileSha256 $validationPath)) { throw 'Geometry validation differs from fact-audit freeze' }
if ($freeze.projectionFileSha256 -ne (Get-FileSha256 $projectionPath)) { throw 'Source projection differs from fact-audit freeze' }
if ($freeze.nativeInputFileSha256 -ne (Get-FileSha256 $nativeInputPath)) { throw 'Native input differs from fact-audit freeze' }
if ($freeze.mechanicalAuditSha256 -ne (Get-FileSha256 $mechanicalPath)) { throw 'Mechanical ledger differs from fact-audit freeze' }
if ($freeze.runnerSha256 -ne (Get-FileSha256 $PSCommandPath)) { throw 'Native runner source changed after freeze' }
if ($freeze.launcherSha256 -ne (Get-FileSha256 $launcher)) { throw 'Native harness launcher changed after freeze' }
if ($candidate.sourceBundleSha256 -ne $validation.sourceBundleSha256 -or $candidate.sourceBundleSha256 -ne $projection.sourceBundleSha256) {
  throw 'Candidate, validation and projection do not bind the same source bundle'
}
if ($validation.candidateReceiptSha256 -ne (Get-FileSha256 $candidatePath) -or $projection.candidateReceiptSha256 -ne (Get-FileSha256 $candidatePath)) {
  throw 'Validation or projection does not bind the exact run-5 receipt'
}
if ($validation.semanticStatus -ne 'NOT_ASSESSED' -or $validation.graphAdmission -notlike 'NONE;*') { throw 'Fact candidates must remain unassessed and outside graph admission' }
if ($projection.semanticStatus -ne 'NOT_ASSESSED' -or -not $projection.sourceTextOnly -or $projection.candidateGraphIncluded -ne $false -or $projection.candidateDescriptionsIncluded -ne $false) {
  throw 'Projection must remain source-text-only with candidate descriptions and graph fields excluded'
}
if ($projection.textSha256 -ne (Get-Utf8Sha256 ([string]$projection.text))) { throw 'Projection text hash mismatch' }

$arm = $nativeInput.arms | Where-Object parser -eq $armName | Select-Object -First 1
if (-not $arm) { throw "Native input lacks $armName" }
if ($arm.contentSha256 -ne (Get-Utf8Sha256 ([string]$arm.content))) { throw 'Native fact-audit arm content hash mismatch' }
if ($arm.projection.sourceTextSha256 -ne $projection.textSha256 -or -not ([string]$arm.content).EndsWith([string]$projection.text, [StringComparison]::Ordinal)) {
  throw 'Native arm does not end with the exact frozen source projection'
}
if ($arm.projection.validationFileSha256 -ne $freeze.validationFileSha256 -or
    $arm.projection.candidateReceiptSha256 -ne $freeze.candidateReceiptSha256 -or
    $arm.ranges.Count -ne $projection.snippets.Count) {
  throw 'Native arm ranges or validation/candidate bindings differ from the frozen projection'
}
if ($arm.projection.semanticStatus -ne 'NOT_ASSESSED' -or $arm.projection.graphFieldsIncluded -ne $false -or $arm.projection.candidateTextIncluded -ne $false) {
  throw 'Native arm must contain source text only and keep candidate semantics unassessed'
}
if ($nativeInput.hyperCandidateSidecar.graphStatus -ne 'SIDE_CAR_ONLY_NOT_INGESTED' -or $nativeInput.hyperCandidateSidecar.semanticStatus -ne 'NOT_ASSESSED') {
  throw 'Candidate sidecar must not be ingested or promoted'
}
if ($nativeInput.arms.Count -ne 3 -or @($nativeInput.arms.parser | Sort-Object -Unique).Count -ne 3) { throw 'Native input must contain exactly three unique arms' }
if ($validation.facts.Count -ne 120 -or @($validation.facts.candidateId | Sort-Object -Unique).Count -ne 120) { throw 'Geometry validation must recheck 120 unique candidate facts' }
$expectedCandidateIds = @()
foreach ($document in $candidate.documents) {
  foreach ($chunk in $document.chunks) {
    for ($index = 0; $index -lt $chunk.facts.Count; $index++) {
      $expectedCandidateIds += "{0}:{1}:fact:{2}" -f $document.sourceId, $chunk.chunkIndex, $index
    }
  }
}
if ($expectedCandidateIds.Count -ne 120 -or (@($expectedCandidateIds | Sort-Object -Unique).Count -ne 120)) { throw 'Run-5 receipt does not enumerate 120 unique fact candidate IDs' }
if ((@($expectedCandidateIds | Sort-Object) -join "`n") -cne (@($validation.facts.candidateId | Sort-Object) -join "`n")) { throw 'Geometry validation candidate IDs differ from the immutable run-5 receipt' }

foreach ($parser in @('plain', 'table')) {
  $baseArm = $baseInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  $candidateArm = $nativeInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  if (-not $baseArm -or -not $candidateArm -or $baseArm.contentSha256 -ne $candidateArm.contentSha256 -or $baseArm.content -cne $candidateArm.content) {
    throw "Frozen $parser baseline arm changed"
  }
}

foreach ($range in $arm.ranges) {
  if ($range.doc -notin @('economy', 'population')) { throw "Unexpected native range document: $($range.doc)" }
  if ($range.start -lt 0 -or $range.end -le $range.start -or $range.end -gt $arm.content.Length) { throw "Invalid native range offsets: $($range.id)" }
  $text = [string]$arm.content.Substring([int]$range.start, [int]($range.end - $range.start))
  if ((Get-Utf8Sha256 $text) -ne [string]$range.textSha256) { throw "Native source range hash mismatch: $($range.id)" }
}

if ($PreflightOnly) {
  $preflight = [ordered]@{
    status = 'PASS_HOST_PREFLIGHT_ONLY'
    dockerLaunched = $false
    runId = $candidate.runId
    sourceBundleFileSha256 = Get-FileSha256 $sourceBundlePath
    sourceBundleContentSha256 = Get-JsonObjectSha256 $sourceBundlePath
    candidateReceiptSha256 = Get-FileSha256 $candidatePath
    validationFileSha256 = Get-FileSha256 $validationPath
    projectionFileSha256 = Get-FileSha256 $projectionPath
    nativeInputFileSha256 = Get-FileSha256 $nativeInputPath
    nativeArm = $armName
    nativeArmContentSha256 = $arm.contentSha256
    nativeRanges = $arm.ranges.Count
    validationCandidateFacts = $validation.facts.Count
    uniqueCandidateIds = @($validation.facts.candidateId | Sort-Object -Unique).Count
    arms = @($nativeInput.arms | ForEach-Object { [ordered]@{ parser = $_.parser; contentSha256 = $_.contentSha256; rangeCount = $_.ranges.Count } })
    goldQuestionsOrMetricsUsed = $false
  }
  $preflightPath = Join-Path $bench 'native-host-preflight.json'
  $preflight | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $preflightPath -Encoding utf8
  $preflight | ConvertTo-Json -Depth 8
  exit 0
}

New-Item -ItemType Directory -Path $out | Out-Null
$dockerArguments = @(
  'run', '--name', $containerName, '--network', 'none', '--cpus', '2', '--memory', '6g', '--memory-swap', '6g',
  '--mount', "type=bind,src=$out,dst=/bench",
  '--mount', "type=bind,src=$launcher,dst=/launch/launch-native-v6.mjs,readonly",
  '--mount', "type=bind,src=$harness,dst=/harness,readonly",
  '--mount', "type=bind,src=$previous,dst=/previous,readonly",
  '--mount', "type=bind,src=$repo/apps/server/src,dst=/app/src,readonly",
  '--mount', "type=bind,src=$repo/apps/server/tests,dst=/app/tests,readonly",
  '--mount', "type=bind,src=$repo/apps/server/scripts,dst=/app/scripts,readonly",
  '--mount', "type=bind,src=$repo/apps/server/prisma/schema.prisma,dst=/app/prisma/schema.prisma,readonly",
  '--mount', "type=bind,src=$nativeInputPath,dst=/input/native-input.json,readonly",
  '--mount', 'type=volume,src=zuri-main-dev-20261020_ki17-model,dst=/model,readonly',
  '-e', "BENCH_ARM=$armName", '-e', 'KI17_MODEL_DIR=/model/614241f622f53c4eeff9890bdc4f31cfecc418b3',
  '--entrypoint', 'node', $image, '/launch/launch-native-v6.mjs'
)
$dockerArguments | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bench 'native-command-geometry-v1.json') -Encoding utf8
& docker @dockerArguments *> (Join-Path $bench 'native-run-geometry-v1.log')
$runExit = $LASTEXITCODE
docker inspect --format '{{json .State}}' $containerName | Set-Content -LiteralPath (Join-Path $bench 'native-state-geometry-v1.json') -Encoding utf8
docker cp "${containerName}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js')
Write-Output "hyper fact audit native attempt exit $runExit"
if ($runExit -ne 0) { exit $runExit }
