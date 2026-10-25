param(
  [Parameter(Mandatory = $true)][ValidateSet('table', 'source-native-all-rows-v1')][string]$Arm,
  [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$runDir = (Resolve-Path -LiteralPath '.local/hyper-extraction-repair-20261025').Path
$nativeInputPath = (Resolve-Path -LiteralPath (Join-Path $runDir 'native-input-source-native-v1.json')).Path
$nativeFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir 'native-input-source-native-freeze.json')).Path
$baseInputPath = (Resolve-Path -LiteralPath '.local/thai-table-chunking-20261025/run-v2/native-input.json').Path
$sourceNativeFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir 'source-native-freeze.json')).Path
$projectionPath = (Resolve-Path -LiteralPath (Join-Path $runDir 'source-native-projection.json')).Path
$projectionFreezePath = (Resolve-Path -LiteralPath (Join-Path $runDir 'source-native-projection-freeze.json')).Path
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
$attempt = 'attempt-1'
$profileName = if ($Arm -eq 'table') { 'table-current' } else { 'source-native-all-rows-v1' }
$out = Join-Path $runDir "native-$profileName-$attempt"
$preflightPath = Join-Path $runDir "native-host-preflight-$profileName.json"
$containerName = "zuri-thai-extraction-repair-$profileName-$attempt"

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-Utf8Sha256([string]$Text) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToHexString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

$inputFreeze = Get-Content -LiteralPath $nativeFreezePath -Raw | ConvertFrom-Json
$nativeInput = Get-Content -LiteralPath $nativeInputPath -Raw | ConvertFrom-Json
$baseInput = Get-Content -LiteralPath $baseInputPath -Raw | ConvertFrom-Json
$sourceFreeze = Get-Content -LiteralPath $sourceNativeFreezePath -Raw | ConvertFrom-Json
$projection = Get-Content -LiteralPath $projectionPath -Raw | ConvertFrom-Json
$projectionFreeze = Get-Content -LiteralPath $projectionFreezePath -Raw | ConvertFrom-Json

$inputPaths = @{
  baselineNativeInput = $baseInputPath
  sourceNativeEnumeration = Join-Path $runDir 'source-native-enumeration.json'
  sourceNativeFreeze = $sourceNativeFreezePath
  sourceNativeProjection = $projectionPath
  sourceNativeProjectionFreeze = $projectionFreezePath
  sourceBundle = $sourceBundlePath
}
foreach ($key in $inputPaths.Keys) {
  if ($inputFreeze.inputSha256.$key -ne (Get-FileSha256 $inputPaths[$key])) { throw "Frozen native-input source changed: $key" }
}
if ($inputFreeze.nativeInputSha256 -ne (Get-FileSha256 $nativeInputPath)) { throw 'Native input differs from its freeze' }
if ($inputFreeze.implementationSha256.builder -ne (Get-FileSha256 'reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1/build_native_input.py')) { throw 'Native input builder differs from freeze' }
if ($inputFreeze.implementationSha256.nativeInputTests -ne (Get-FileSha256 'reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1/test_native_input.py')) { throw 'Native input tests differ from freeze' }
if ($projectionFreeze.sourceNativeFreezeSha256 -ne (Get-FileSha256 $sourceNativeFreezePath) -or
    $projectionFreeze.sourceNativeProjectionSha256 -ne (Get-FileSha256 $projectionPath) -or
    $sourceFreeze.inputSha256.sourceBundle -ne (Get-FileSha256 $sourceBundlePath)) {
  throw 'Source bundle/native enumeration/projection freeze chain mismatch'
}

$expectedArms = @('plain', 'table', 'source-native-all-rows-v1')
if ($nativeInput.arms.Count -ne 3 -or (@($nativeInput.arms.parser | Sort-Object) -join ',') -cne (@($expectedArms | Sort-Object) -join ',')) { throw 'Native input arm set is not the frozen three-arm profile' }
foreach ($parser in @('plain', 'table')) {
  $baselineArm = $baseInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  $currentArm = $nativeInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  if (-not $baselineArm -or -not $currentArm -or $baselineArm.content -cne $currentArm.content -or
      $baselineArm.contentSha256 -ne $currentArm.contentSha256 -or $currentArm.contentSha256 -ne (Get-Utf8Sha256 ([string]$currentArm.content))) {
    throw "Frozen baseline $parser arm content changed"
  }
  if ($currentArm.ranges.Count -ne $baselineArm.ranges.Count) { throw "Frozen baseline $parser range count changed" }
  for ($i = 0; $i -lt $currentArm.ranges.Count; $i++) {
    if ($currentArm.ranges[$i].id -ne $baselineArm.ranges[$i].id -or $currentArm.ranges[$i].doc -ne $baselineArm.ranges[$i].id) {
      throw "Frozen baseline $parser range mapping changed beyond adding document identity"
    }
  }
}
$sourceArm = $nativeInput.arms | Where-Object parser -eq 'source-native-all-rows-v1' | Select-Object -First 1
if (-not $sourceArm -or $sourceArm.contentSha256 -ne (Get-Utf8Sha256 ([string]$sourceArm.content))) { throw 'Source-native arm content hash mismatch' }
if ($sourceArm.projection.sourceNativeFreezeSha256 -ne (Get-FileSha256 $sourceNativeFreezePath) -or
    $sourceArm.projection.sourceNativeProjectionFreezeSha256 -ne (Get-FileSha256 $projectionFreezePath) -or
    $sourceArm.projection.sourceNativeProjectionSha256 -ne (Get-FileSha256 $projectionPath) -or
    $sourceArm.projection.sourceRangeCoveragePct -ne 100 -or
    $sourceArm.projection.semanticStatus -ne 'NOT_ASSESSED' -or $sourceArm.projection.graphAdmission -ne 'NONE' -or
    $sourceArm.projection.candidateGraphIncluded -ne $false -or $nativeInput.candidateSidecarIncluded -ne $false) {
  throw 'Source-native arm profile/provenance or non-authority boundary mismatch'
}
if (-not ([string]$sourceArm.content).EndsWith([string]$projection.text, [StringComparison]::Ordinal)) { throw 'Source-native arm does not preserve the full frozen source projection' }
foreach ($range in $sourceArm.ranges) {
  if ($range.doc -notin @('economy', 'population') -or $range.end -le $range.start -or $range.end -gt $sourceArm.content.Length) { throw "Invalid source-native range $($range.id)" }
  $slice = [string]$sourceArm.content.Substring([int]$range.start, [int]($range.end - $range.start))
  if ((Get-Utf8Sha256 $slice) -ne [string]$range.textSha256) { throw "Source-native range hash mismatch $($range.id)" }
}
$selectedArm = $nativeInput.arms | Where-Object parser -eq $Arm | Select-Object -First 1
if (-not $selectedArm) { throw "Native input does not contain selected arm: $Arm" }

$nativeDocker = Get-Command docker -ErrorAction Stop
$imageId = (& docker image inspect $image --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0 -or $imageId -ne $image) { throw 'Pinned native runtime image unavailable or mismatched' }
$volumeName = (& docker volume inspect $volume --format '{{.Name}}').Trim()
if ($LASTEXITCODE -ne 0 -or $volumeName -ne $volume) { throw 'Pinned read-only E5 model volume unavailable' }
if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite existing native output: $out" }

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
  inputFreezeSha256 = Get-FileSha256 $nativeFreezePath
  nativeInputSha256 = Get-FileSha256 $nativeInputPath
  armContentSha256 = $selectedArm.contentSha256
  armCharacters = $selectedArm.content.Length
  armRangeCount = $selectedArm.ranges.Count
  sourceProjectionFreezeSha256 = Get-FileSha256 $projectionFreezePath
  sourceBundleFileSha256 = Get-FileSha256 $sourceBundlePath
  baselineContentPreserved = $true
  sourceRangeCoveragePct = $sourceArm.projection.sourceRangeCoveragePct
  generatedFramingChars = $sourceArm.projection.generatedFramingChars
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
& docker @dockerArguments *> (Join-Path $out 'native-run.log')
$runExit = $LASTEXITCODE
& docker inspect --format '{{json .State}}' $containerName | Set-Content -LiteralPath (Join-Path $out 'native-state.json') -Encoding utf8
& docker cp "${containerName}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js') *> $null
Write-Output "source-native repair native arm $Arm exit $runExit"
if ($runExit -ne 0) { exit $runExit }
