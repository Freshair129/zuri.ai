param(
  [Parameter(Mandatory = $true)][ValidateSet('global', 'batch32')][string]$Mode,
  [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$raw = (Resolve-Path -LiteralPath '.local/hyper-economy-cell-repair-20261025').Path
$experimentRaw = (Resolve-Path -LiteralPath '.local/e5-microbatch-20261025').Path
$embedderPath = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/e5-microbatch-v1/embedder_batch32.py').Path
$batchSize = if ($Mode -eq 'global') { '0' } else { '32' }
$nativeInputPath = (Resolve-Path -LiteralPath (Join-Path $raw 'native-input-economy-pdf-rows-v1.json')).Path
$nativeFreezePath = (Resolve-Path -LiteralPath (Join-Path $raw 'native-input-economy-pdf-rows-freeze-v1.json')).Path
$rowsPath = (Resolve-Path -LiteralPath (Join-Path $raw 'pdf-baseline-rows-v1.json')).Path
$probePath = (Resolve-Path -LiteralPath (Join-Path $raw 'native-chunker-probe-v1.json')).Path
$baselinePath = (Resolve-Path -LiteralPath '.local/thai-table-chunking-20261025/run-v2/native-input.json').Path
$baselineChunksPath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/native-table-current-attempt-1/chunks.json').Path
$priorNativePath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2.json').Path
$priorNativeFreezePath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2-freeze.json').Path
$priorProjectionPath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2.json').Path
$priorProjectionFreezePath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2-freeze.json').Path
$sourceFreezePath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/held-cell-freeze-v1.json').Path
$enumerationPath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/held-cell-enumeration-v1.json').Path
$valueFreezePath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/pdf-cell-value-freeze-v1.json').Path
$valueEvidencePath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/pdf-cell-value-evidence-v1.json').Path
$sourceBundlePath = (Resolve-Path -LiteralPath '.local/hyper-relation-audit-20261025/run-5/source-bundle.json').Path
$geometryPath = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025/pdf-vector-geometry-v1.json').Path
$harness = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-extract-v1').Path
$launcher = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/launch-native-v6.mjs').Path
$previous = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native').Path
$nativeTest = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-extract-v1/native.test.js').Path
$nativeConfig = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native/native.config.mjs').Path
$goldManifest = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json').Path
$batchingTest = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/e5-microbatch-v1/test_embedder_batching.py').Path
$pdf = (Resolve-Path -LiteralPath '.local/thai-native-20261025/input/economy.pdf').Path
$paddle = (Resolve-Path -LiteralPath '.local/thai-native-20261025/paddle-2/economy.json').Path
$image = 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'
$volume = 'zuri-main-dev-20261020_ki17-model'
$modelDir = '/model/614241f622f53c4eeff9890bdc4f31cfecc418b3'
$arm = 'source-pdf-repair-plus-economy-rows-v1'
$out = Join-Path $experimentRaw "native-$Mode-attempt-1"
$preflightPath = Join-Path $experimentRaw "native-host-preflight-e5-$Mode-v1.json"
$containerName = "zuri-thai-e5-$Mode-attempt-1"

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-Utf8Sha256([string]$Text) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}
function ConvertTo-CompactJson($Value) {
  return ConvertTo-Json -InputObject $Value -Depth 40 -Compress
}

$nativeInput = Get-Content -LiteralPath $nativeInputPath -Raw | ConvertFrom-Json
$nativeFreeze = Get-Content -LiteralPath $nativeFreezePath -Raw | ConvertFrom-Json
$base = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
$priorNative = Get-Content -LiteralPath $priorNativePath -Raw | ConvertFrom-Json
$priorFreeze = Get-Content -LiteralPath $priorNativeFreezePath -Raw | ConvertFrom-Json
$priorProjection = Get-Content -LiteralPath $priorProjectionPath -Raw | ConvertFrom-Json
$priorProjectionFreeze = Get-Content -LiteralPath $priorProjectionFreezePath -Raw | ConvertFrom-Json
$sourceFreeze = Get-Content -LiteralPath $sourceFreezePath -Raw | ConvertFrom-Json
$enumeration = Get-Content -LiteralPath $enumerationPath -Raw | ConvertFrom-Json
$valueFreeze = Get-Content -LiteralPath $valueFreezePath -Raw | ConvertFrom-Json
$valueEvidence = Get-Content -LiteralPath $valueEvidencePath -Raw | ConvertFrom-Json
$rows = Get-Content -LiteralPath $rowsPath -Raw | ConvertFrom-Json
$probe = Get-Content -LiteralPath $probePath -Raw | ConvertFrom-Json

$inputPaths = [ordered]@{
  baselineNativeInput = $baselinePath
  priorNativeInput = $priorNativePath
  priorNativeFreeze = $priorNativeFreezePath
  priorProjection = $priorProjectionPath
  priorProjectionFreeze = $priorProjectionFreezePath
  pdfBaselineRows = $rowsPath
}
foreach ($key in $inputPaths.Keys) {
  if ($nativeFreeze.inputSha256.$key -ne (Get-FileSha256 $inputPaths[$key])) { throw "Frozen native-input source changed: $key" }
}
if ($nativeFreeze.nativeInputSha256 -ne (Get-FileSha256 $nativeInputPath)) { throw 'Combined native input differs from its freeze' }
if ($priorFreeze.nativeInputSha256 -ne (Get-FileSha256 $priorNativePath)) { throw 'Prior native input differs from its frozen receipt' }
if ($priorFreeze.inputSha256.baselineNativeInput -ne (Get-FileSha256 $baselinePath) -or
    $priorFreeze.inputSha256.sourceNativeFreeze -ne (Get-FileSha256 $sourceFreezePath) -or
    $priorFreeze.inputSha256.sourceNativeEnumeration -ne (Get-FileSha256 $enumerationPath) -or
    $priorFreeze.inputSha256.pdfValueFreeze -ne (Get-FileSha256 $valueFreezePath) -or
    $priorFreeze.inputSha256.pdfValueEvidence -ne (Get-FileSha256 $valueEvidencePath) -or
    $priorFreeze.inputSha256.pdfVectorGeometry -ne (Get-FileSha256 $geometryPath) -or
    $priorFreeze.inputSha256.sourceBundle -ne (Get-FileSha256 $sourceBundlePath) -or
    $priorFreeze.inputSha256.repairProjection -ne (Get-FileSha256 $priorProjectionPath) -or
    $priorFreeze.inputSha256.repairProjectionFreeze -ne (Get-FileSha256 $priorProjectionFreezePath)) { throw 'Prior repair freeze chain changed' }
if ($enumeration.freezeSha256 -ne (Get-FileSha256 $sourceFreezePath) -or
    $valueEvidence.freezeSha256 -ne (Get-FileSha256 $valueFreezePath) -or
    $priorProjectionFreeze.projectionSha256 -ne (Get-FileSha256 $priorProjectionPath) -or
    $priorProjection.inputSha256.sourceNativeEnumeration -ne (Get-FileSha256 $enumerationPath) -or
    $priorProjection.inputSha256.pdfValueEvidence -ne (Get-FileSha256 $valueEvidencePath) -or
    $priorProjection.inputSha256.pdfVectorGeometry -ne (Get-FileSha256 $geometryPath) -or
    $priorProjection.inputSha256.sourceBundle -ne (Get-FileSha256 $sourceBundlePath) -or
    $priorProjectionFreeze.inputSha256.sourceNativeFreeze -ne (Get-FileSha256 $sourceFreezePath) -or
    $priorProjectionFreeze.inputSha256.pdfValueFreeze -ne (Get-FileSha256 $valueFreezePath) -or
    $priorProjectionFreeze.inputSha256.baselineNativeInput -ne (Get-FileSha256 $baselinePath)) { throw 'Prior source/value/projection dependency chain changed' }
if ($nativeInput.candidateSidecarIncluded -ne $false -or $nativeInput.semanticStatus -ne 'NOT_ASSESSED' -or $nativeInput.graphAdmission -ne 'NONE') { throw 'Candidate must remain non-authoritative source text' }
if ($rows.summary.candidateRows -ne 37 -or $rows.summary.candidateValueCells -ne 259 -or
    $rows.summary.legacyCellStatusesCarriedIntoSourceRows -ne 0 -or $rows.summary.modelCalls -ne 0) { throw 'PDF source row receipt changed from its frozen profile' }
if ($rows.inputs.pdf.sha256 -ne (Get-FileSha256 $pdf) -or
    $rows.inputs.paddleRaw.sha256 -ne (Get-FileSha256 $paddle) -or
    $rows.inputs.enumeration.sha256 -ne (Get-FileSha256 $enumerationPath) -or
    $rows.inputs.enumerationFreeze.sha256 -ne (Get-FileSha256 $sourceFreezePath) -or
    $rows.inputs.pdfVectorGeometry.sha256 -ne (Get-FileSha256 $geometryPath)) { throw 'PDF, Paddle, enumeration, or geometry source changed after row derivation' }
if ($probe.status -ne 'PASS_NO_QA' -or $probe.inputs.nativeInput -ne (Get-FileSha256 $nativeInputPath) -or
    $probe.inputs.nativeFreeze -ne (Get-FileSha256 $nativeFreezePath) -or
    $probe.sourceRows.expectedRows -ne 37 -or $probe.sourceRows.rowLabelAndAllSevenHeaderValueAtomsInOneChunk -ne 37 -or
    $probe.priorPdfRepairRows.expectedRows -ne 59 -or $probe.priorPdfRepairRows.unchangedBodiesInOneNativeChunk -ne 59 -or
    $probe.goldQuestionsOrMetricsReadOrUsed -ne $false) { throw 'No-QA parser probe does not bind all 59 prior and 37 new row bodies' }

$baseArms = @($base.arms)
$sourceArms = @($nativeInput.arms)
$basePlain = $baseArms | Where-Object parser -eq 'plain' | Select-Object -First 1
$baseTable = $baseArms | Where-Object parser -eq 'table' | Select-Object -First 1
$plain = $sourceArms | Where-Object parser -eq 'plain' | Select-Object -First 1
$table = $sourceArms | Where-Object parser -eq 'table' | Select-Object -First 1
$candidate = $sourceArms | Where-Object parser -eq $arm | Select-Object -First 1
$priorCandidate = @($priorNative.arms) | Where-Object parser -eq 'source-pdf-repair-v1' | Select-Object -First 1
if ($sourceArms.Count -ne 3 -or -not $candidate -or -not $priorCandidate) { throw 'Native input arm set or prior source arm is invalid' }
foreach ($pair in @(@($basePlain, $plain), @($baseTable, $table))) {
  if ($pair[0].content -cne $pair[1].content -or $pair[0].contentSha256 -ne $pair[1].contentSha256 -or
      $pair[1].contentSha256 -ne (Get-Utf8Sha256 ([string]$pair[1].content))) { throw "Frozen baseline arm changed: $($pair[0].parser)" }
}
if (-not ([string]$candidate.content).StartsWith([string]$priorCandidate.content, [StringComparison]::Ordinal) -or
    $candidate.contentSha256 -ne (Get-Utf8Sha256 ([string]$candidate.content))) { throw 'Combined candidate does not preserve the exact prior PDF overlay content prefix' }
if ($candidate.derivedRowProfile.sourceRows -ne 37 -or $candidate.derivedRowProfile.sourceValueCells -ne 259 -or
    $candidate.derivedRowProfile.semanticStatus -ne 'NOT_ASSESSED' -or $candidate.derivedRowProfile.graphAdmission -ne 'NONE') { throw 'Candidate source row profile changed' }
if ($candidate.ranges.Count -lt $priorCandidate.ranges.Count -or $candidate.content.Length -le $priorCandidate.content.Length) { throw 'Combined candidate lacks appended source rows' }
for ($i = 0; $i -lt $priorCandidate.ranges.Count; $i++) {
  if ((ConvertTo-CompactJson $candidate.ranges[$i]) -cne (ConvertTo-CompactJson $priorCandidate.ranges[$i])) { throw "Prior source range prefix changed at index $i" }
}
foreach ($range in $candidate.ranges) {
  $start, $end = [int]$range.start, [int]$range.end
  if (-not $range.doc -or $end -le $start -or $end -gt $candidate.content.Length) { throw "Invalid candidate range bounds: $($range.id)" }
  $slice = [string]$candidate.content.Substring($start, $end - $start)
  if ((Get-Utf8Sha256 $slice) -ne [string]$range.textSha256) { throw "Candidate range text hash mismatch: $($range.id)" }
  if ($range.origin -and (($range.PSObject.Properties.Name -contains 'sourceStart') -or ($range.PSObject.Properties.Name -contains 'sourceEnd'))) { throw "PDF derived range claims old source offsets: $($range.id)" }
}
if ($candidate.ranges.Count - $priorCandidate.ranges.Count -ne 38) { throw 'Expected 1 table-context range plus 37 new economy row ranges' }

$requiredArtifacts = @($rowsPath, $nativeInputPath, $nativeFreezePath, $probePath, $baselinePath, $baselineChunksPath,
  $priorNativePath, $priorNativeFreezePath, $priorProjectionPath, $priorProjectionFreezePath, $sourceBundlePath, $geometryPath,
  $sourceFreezePath, $enumerationPath, $valueFreezePath, $valueEvidencePath, $pdf, $paddle, $nativeTest, $nativeConfig, $goldManifest, $embedderPath, $batchingTest)
foreach ($path in $requiredArtifacts) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing frozen experiment artifact: $path" } }
if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite native output: $out" }

$docker = Get-Command docker -ErrorAction Stop
$imageId = (& docker image inspect $image --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0 -or $imageId -ne $image) { throw 'Pinned GenesisRAG17 image unavailable or mismatched' }
$volumeName = (& docker volume inspect $volume --format '{{.Name}}').Trim()
if ($LASTEXITCODE -ne 0 -or $volumeName -ne $volume) { throw 'Pinned read-only E5 model volume unavailable' }
$codeHashes = [ordered]@{
  runner = Get-FileSha256 $PSCommandPath
  nativeInputBuilder = Get-FileSha256 (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/build_native_input.py').Path
  rowBuilder = Get-FileSha256 (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/build_pdf_baseline_rows.py').Path
  chunkerProbe = Get-FileSha256 (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/native_chunker_probe.mjs').Path
  launcher = Get-FileSha256 $launcher
  nativeTest = Get-FileSha256 $nativeTest
  nativeConfig = Get-FileSha256 $nativeConfig
  goldManifestFile = Get-FileSha256 $goldManifest
  embeddingSidecarOverride = Get-FileSha256 $embedderPath
  batchingContractTest = Get-FileSha256 $batchingTest
}
$preflight = [ordered]@{
  status = 'PASS_HOST_PREFLIGHT_ONLY'
  dockerLaunched = $false
  experiment = 'e5-sequential-microbatch-v1'
  sidecarMode = $Mode
  requestedBatchSize = [int]$batchSize
  capturePath = '/bench/embedding-capture'
  embeddingSidecarBaseImageSha256 = 'dd7e9e51f61faf5a3d6d0bbe894c8c75b235f589c0906ca952c790afeb555e35'
  embeddingSidecarOverrideSha256 = Get-FileSha256 $embedderPath
  arm = $arm
  candidateProfile = $nativeInput.profile
  baselineContentSha256 = $table.contentSha256
  priorPdfOverlayContentSha256 = (Get-Utf8Sha256 ([string]$priorCandidate.content))
  candidateContentSha256 = $candidate.contentSha256
  candidateChars = $candidate.content.Length
  candidateRangeCount = $candidate.ranges.Count
  priorSourceRangePrefixCount = $priorCandidate.ranges.Count
  newContextAndEconomyRows = 38
  sourceRows = $rows.summary.candidateRows
  sourceValueCells = $rows.summary.candidateValueCells
  nativeInputSha256 = Get-FileSha256 $nativeInputPath
  nativeFreezeSha256 = Get-FileSha256 $nativeFreezePath
  chunkerProbeSha256 = Get-FileSha256 $probePath
  chunkerProbePriorRowsOneChunk = $probe.priorPdfRepairRows.unchangedBodiesInOneNativeChunk
  chunkerProbeNewRowsOneChunk = $probe.sourceRows.rowLabelAndAllSevenHeaderValueAtomsInOneChunk
  baselineAndPriorNativeReceiptsReusedWithoutRerun = $true
  priorOverlayContentAndRangePrefixPreserved = $true
  goldQuestionsReadByHostPreflight = $false
  pinnedImage = $imageId
  readonlyModelVolume = $volumeName
  modelDirectory = $modelDir
  resources = @{ network = 'none'; cpu = 2; memoryGiB = 6; memorySwapGiB = 6; modelVolumeReadOnly = $true }
  codeHashes = $codeHashes
}
if ($PreflightOnly) {
  $preflight | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $preflightPath -Encoding utf8
  $preflight | ConvertTo-Json -Depth 12
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
  '--mount', "type=bind,src=$embedderPath,dst=/opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py,readonly",
  '--mount', "type=volume,src=$volume,dst=/model,readonly",
  '-e', "BENCH_ARM=$arm", '-e', "KI17_MODEL_DIR=$modelDir",
  '-e', "KI17_EMBED_BATCH_SIZE=$batchSize", '-e', 'KI17_EMBED_CAPTURE_DIR=/bench/embedding-capture',
  '--entrypoint', 'node', $image, '/launch/launch-native-v6.mjs'
)
$dockerArguments | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'native-command.json') -Encoding utf8
$preflight.dockerLaunched = $true
$preflight | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $out 'native-launch-profile.json') -Encoding utf8
$previousErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  & docker @dockerArguments *> (Join-Path $out 'native-run.log')
  $runExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
& docker inspect --format '{{json .State}}' $containerName | Set-Content -LiteralPath (Join-Path $out 'native-state.json') -Encoding utf8
& docker cp "${containerName}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js') *> $null
Write-Output "combined PDF repair native arm exit $runExit"
if ($runExit -ne 0) { exit $runExit }
