param(
  [Parameter(Mandatory = $true)][ValidateSet('table', 'source-pdf-repair-v1')][string]$Arm,
  [ValidateSet('attempt-1', 'attempt-2')][string]$Attempt = 'attempt-1',
  [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$runDir = (Resolve-Path -LiteralPath '.local/hyper-held-cell-audit-20261025').Path
$layoutSuffix = if ($Attempt -eq 'attempt-1') { 'v1' } else { 'layout-v2' }
if ($Attempt -eq 'attempt-1') {
  $nativeInputFile = 'native-input-held-cell-repair-v1.json'
  $nativeFreezeFile = 'native-input-held-cell-repair-freeze-v1.json'
  $projectionFile = 'held-cell-repair-projection-v1.json'
  $projectionFreezeFile = 'held-cell-repair-projection-freeze-v1.json'
} else {
  $nativeInputFile = 'native-input-held-cell-repair-layout-v2.json'
  $nativeFreezeFile = 'native-input-held-cell-repair-layout-v2-freeze.json'
  $projectionFile = 'held-cell-repair-projection-layout-v2.json'
  $projectionFreezeFile = 'held-cell-repair-projection-layout-v2-freeze.json'
}
$nativeInputPath = (Resolve-Path -LiteralPath (Join-Path $runDir $nativeInputFile)).Path
$nativeFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir $nativeFreezeFile)).Path
$baselinePath = (Resolve-Path -LiteralPath '.local/thai-table-chunking-20261025/run-v2/native-input.json').Path
$heldFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir 'held-cell-freeze-v1.json')).Path
$enumerationPath = (Resolve-Path -LiteralPath (Join-Path $runDir 'held-cell-enumeration-v1.json')).Path
$valueFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir 'pdf-cell-value-freeze-v1.json')).Path
$valueEvidencePath = (Resolve-Path -LiteralPath (Join-Path $runDir 'pdf-cell-value-evidence-v1.json')).Path
$geometryPath = (Resolve-Path -LiteralPath (Join-Path $runDir 'pdf-vector-geometry-v1.json')).Path
$projectionPath = (Resolve-Path -LiteralPath (Join-Path $runDir $projectionFile)).Path
$projectionFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir $projectionFreezeFile)).Path
$chunkProbePath = if ($Attempt -eq 'attempt-2') { (Resolve-Path -LiteralPath (Join-Path $runDir 'native-chunker-probe-layout-v2.json')).Path } else { $null }
$sourceBundlePath = (Resolve-Path -LiteralPath '.local/hyper-relation-audit-20261025/run-5/source-bundle.json').Path
$harness = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-extract-v1').Path
$launcher = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/launch-native-v6.mjs').Path
$previous = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native').Path
$nativeTest = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-extract-v1/native.test.js').Path
$nativeConfig = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native/native.config.mjs').Path
$goldManifest = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native/evidence-manifest.json').Path
$image = 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'
$volume = 'zuri-main-dev-20261020_ki17-model'
$modelDir = '/model/614241f622f53c4eeff9890bdc4f31cfecc418b3'
$profileName = if ($Arm -eq 'table') { 'table-current' } else { 'source-pdf-repair-v1' }
$out = Join-Path $runDir "native-$profileName-$Attempt"
$preflightName = if ($Attempt -eq 'attempt-2') { "$profileName-layout-v2" } else { $profileName }
$preflightPath = Join-Path $runDir "native-host-preflight-$preflightName.json"
$containerName = "zuri-thai-held-cell-$profileName-$Attempt"

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-Utf8Sha256([string]$Text) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

$inputFreeze = Get-Content -LiteralPath $nativeFreezePath -Raw | ConvertFrom-Json
$nativeInput = Get-Content -LiteralPath $nativeInputPath -Raw | ConvertFrom-Json
$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
$heldFreeze = Get-Content -LiteralPath $heldFreezePath -Raw | ConvertFrom-Json
$enumeration = Get-Content -LiteralPath $enumerationPath -Raw | ConvertFrom-Json
$valueFreeze = Get-Content -LiteralPath $valueFreezePath -Raw | ConvertFrom-Json
$valueEvidence = Get-Content -LiteralPath $valueEvidencePath -Raw | ConvertFrom-Json
$geometry = Get-Content -LiteralPath $geometryPath -Raw | ConvertFrom-Json
$projection = Get-Content -LiteralPath $projectionPath -Raw | ConvertFrom-Json
$projectionFreeze = Get-Content -LiteralPath $projectionFreezePath -Raw | ConvertFrom-Json
$chunkProbe = if ($chunkProbePath) { Get-Content -LiteralPath $chunkProbePath -Raw | ConvertFrom-Json } else { $null }

$inputPaths = @{
  baselineNativeInput = $baselinePath
  sourceNativeFreeze = $heldFreezePath
  sourceNativeEnumeration = $enumerationPath
  pdfValueFreeze = $valueFreezePath
  pdfValueEvidence = $valueEvidencePath
  pdfVectorGeometry = $geometryPath
  sourceBundle = $sourceBundlePath
  repairProjection = $projectionPath
  repairProjectionFreeze = $projectionFreezePath
}
foreach ($key in $inputPaths.Keys) {
  if ($inputFreeze.inputSha256.$key -ne (Get-FileSha256 $inputPaths[$key])) { throw "Frozen native-input source changed: $key" }
}
if ($inputFreeze.nativeInputSha256 -ne (Get-FileSha256 $nativeInputPath)) { throw 'Native input differs from its freeze' }
if ($enumeration.freezeSha256 -ne (Get-FileSha256 $heldFreezePath)) { throw 'All-cell enumeration/freeze mismatch' }
if ($valueEvidence.freezeSha256 -ne (Get-FileSha256 $valueFreezePath)) { throw 'PDF value evidence/freeze mismatch' }
if ($projectionFreeze.projectionSha256 -ne (Get-FileSha256 $projectionPath) -or
    $projection.inputSha256.sourceNativeEnumeration -ne (Get-FileSha256 $enumerationPath) -or
    $projection.inputSha256.pdfValueEvidence -ne (Get-FileSha256 $valueEvidencePath) -or
    $projection.inputSha256.pdfVectorGeometry -ne (Get-FileSha256 $geometryPath) -or
    $projection.inputSha256.sourceBundle -ne (Get-FileSha256 $sourceBundlePath)) {
  throw 'Source/PDF geometry/value/projection freeze chain mismatch'
}
if ($projectionFreeze.inputSha256.sourceNativeFreeze -ne (Get-FileSha256 $heldFreezePath) -or
    $projectionFreeze.inputSha256.pdfValueFreeze -ne (Get-FileSha256 $valueFreezePath) -or
    $projectionFreeze.inputSha256.baselineNativeInput -ne (Get-FileSha256 $baselinePath)) {
  throw 'Projection freeze does not bind its source/value/baseline inputs'
}
if ($Attempt -eq 'attempt-2' -and ($chunkProbe.status -ne 'PASS_NO_QA' -or
    $chunkProbe.inputs.nativeInputSha256 -ne (Get-FileSha256 $nativeInputPath) -or
    $chunkProbe.inputs.projectionSha256 -ne (Get-FileSha256 $projectionPath) -or
    $chunkProbe.sourceRows.expectedCompleteRowBodies -ne 59 -or
    $chunkProbe.sourceRows.bodyLineWholeInExactlyOneNativeChunk -ne 59 -or
    $chunkProbe.goldQuestionsOrMetricsReadOrUsed -ne $false)) {
  throw 'No-QA native chunk-boundary probe does not bind the 59-row treatment'
}
if ($inputFreeze.inputSha256.repairProjection -ne (Get-FileSha256 $projectionPath) -or
    $inputFreeze.inputSha256.repairProjectionFreeze -ne (Get-FileSha256 $projectionFreezePath)) {
  throw 'Native input freeze does not bind the treatment projection'
}

$expectedArms = @('plain', 'table', 'source-pdf-repair-v1')
if ($nativeInput.arms.Count -ne 3 -or (@($nativeInput.arms.parser | Sort-Object) -join ',') -cne (@($expectedArms | Sort-Object) -join ',')) { throw 'Native input arm set is not the frozen three-arm profile' }
foreach ($parser in @('plain', 'table')) {
  $baselineArm = $baseline.arms | Where-Object parser -eq $parser | Select-Object -First 1
  $currentArm = $nativeInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  if (-not $baselineArm -or -not $currentArm -or $baselineArm.content -cne $currentArm.content -or
      $baselineArm.contentSha256 -ne $currentArm.contentSha256 -or $currentArm.contentSha256 -ne (Get-Utf8Sha256 ([string]$currentArm.content))) {
    throw "Frozen baseline $parser arm content changed"
  }
}
$baselineTable = $baseline.arms | Where-Object parser -eq 'table' | Select-Object -First 1
$tableArm = $nativeInput.arms | Where-Object parser -eq 'table' | Select-Object -First 1
$repairArm = $nativeInput.arms | Where-Object parser -eq 'source-pdf-repair-v1' | Select-Object -First 1
if (-not $repairArm -or $tableArm.content -cne $baselineTable.content -or
    -not ([string]$repairArm.content).StartsWith([string]$baselineTable.content, [StringComparison]::Ordinal) -or
    $repairArm.sourceRepair.baselineTableContentSha256 -ne (Get-Utf8Sha256 ([string]$baselineTable.content)) -or
    $repairArm.sourceRepair.projectionSha256 -ne (Get-FileSha256 $projectionPath) -or
    $repairArm.sourceRepair.projectionFreezeSha256 -ne (Get-FileSha256 $projectionFreezePath) -or
    $repairArm.sourceRepair.semanticStatus -ne 'NOT_ASSESSED' -or $repairArm.sourceRepair.graphAdmission -ne 'NONE' -or
    $repairArm.sourceRepair.candidateGraphIncluded -ne $false -or $nativeInput.candidateSidecarIncluded -ne $false) {
  throw 'Repair arm baseline-prefix, projection provenance or non-authority boundary mismatch'
}
foreach ($range in $repairArm.ranges) {
  $start, $end = [int]$range.start, [int]$range.end
  if ($range.doc -notin @('economy', 'population') -or $end -le $start -or $end -gt $repairArm.content.Length) { throw "Invalid repair range $($range.id)" }
  $slice = [string]$repairArm.content.Substring($start, $end - $start)
  if ((Get-Utf8Sha256 $slice) -ne [string]$range.textSha256) { throw "Repair range hash mismatch $($range.id)" }
  $rangeProperties = @($range.PSObject.Properties.Name)
  if ($range.origin -and (($rangeProperties -contains 'sourceStart') -or ($rangeProperties -contains 'sourceEnd'))) { throw "Derived repair range falsely claims source offsets: $($range.id)" }
}
$selectedArm = $nativeInput.arms | Where-Object parser -eq $Arm | Select-Object -First 1
if (-not $selectedArm) { throw "Native input does not contain selected arm: $Arm" }
if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite existing native output: $out" }

$nativeDocker = Get-Command docker -ErrorAction Stop
$imageId = (& docker image inspect $image --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0 -or $imageId -ne $image) { throw 'Pinned native runtime image unavailable or mismatched' }
$volumeName = (& docker volume inspect $volume --format '{{.Name}}').Trim()
if ($LASTEXITCODE -ne 0 -or $volumeName -ne $volume) { throw 'Pinned read-only E5 model volume unavailable' }
$codeHashes = [ordered]@{
  runner = Get-FileSha256 $PSCommandPath
  launcher = Get-FileSha256 $launcher
  nativeTest = Get-FileSha256 $nativeTest
  nativeConfig = Get-FileSha256 $nativeConfig
  goldManifestFile = Get-FileSha256 $goldManifest
}
$preflight = [ordered]@{
  status = 'PASS_HOST_PREFLIGHT_ONLY'
  dockerLaunched = $false
  arm = $Arm
  profile = $profileName
  layoutArtifactVariant = $layoutSuffix
  nativeFreezeSha256 = Get-FileSha256 $nativeFreezePath
  nativeInputSha256 = Get-FileSha256 $nativeInputPath
  armContentSha256 = $selectedArm.contentSha256
  armCharacters = $selectedArm.content.Length
  armRangeCount = $selectedArm.ranges.Count
  heldCellFreezeSha256 = Get-FileSha256 $heldFreezePath
  enumerationSha256 = Get-FileSha256 $enumerationPath
  pdfValueFreezeSha256 = Get-FileSha256 $valueFreezePath
  pdfValueEvidenceSha256 = Get-FileSha256 $valueEvidencePath
  pdfGeometrySha256 = Get-FileSha256 $geometryPath
  repairProjectionFreezeSha256 = Get-FileSha256 $projectionFreezePath
  repairProjectionSha256 = Get-FileSha256 $projectionPath
  nativeChunkBoundaryProbeSha256 = if ($chunkProbePath) { Get-FileSha256 $chunkProbePath } else { $null }
  baselineTableContentPreserved = $true
  sourcePdfCorrections = $projection.summary.pdfSourceCorrectionCells
  completeCorrectedRows = $projection.summary.completeCorrectedRows
  heldCellsRemainUnmodifiedSourceContext = $true
  pinnedImage = $imageId
  readonlyModelVolume = $volumeName
  modelDirectory = $modelDir
  resources = @{ network = 'none'; cpu = 2; memoryGiB = 6; memorySwapGiB = 6; modelVolumeReadOnly = $true }
  codeHashes = $codeHashes
  goldAndQuestionsUsedByPreparationOrPreflight = $false
}
if ($PreflightOnly) {
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
  '--mount', "type=volume,src=$volume,dst=/model,readonly",
  '-e', "BENCH_ARM=$Arm", '-e', "KI17_MODEL_DIR=$modelDir",
  '--entrypoint', 'node', $image, '/launch/launch-native-v6.mjs'
)
$dockerArguments | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'native-command.json') -Encoding utf8
$preflight | Add-Member -NotePropertyName dockerLaunched -NotePropertyValue $true -Force
$preflight | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'native-launch-profile.json') -Encoding utf8
$previousErrorActionPreference = $ErrorActionPreference
try {
  # Windows PowerShell 5.1 can promote Docker's stderr warning to a terminating
  # NativeCommandError even when Docker exits 0. Keep stderr in the run log and
  # use Docker's process exit code as the acceptance result.
  $ErrorActionPreference = 'Continue'
  & docker @dockerArguments *> (Join-Path $out 'native-run.log')
  $runExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
& docker inspect --format '{{json .State}}' $containerName | Set-Content -LiteralPath (Join-Path $out 'native-state.json') -Encoding utf8
& docker cp "${containerName}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js') *> $null
Write-Output "held-cell audit native arm $Arm exit $runExit"
if ($runExit -ne 0) { exit $runExit }
