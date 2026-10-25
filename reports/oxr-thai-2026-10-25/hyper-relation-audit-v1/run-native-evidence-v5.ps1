param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$runDir = (Resolve-Path -LiteralPath '.local/hyper-relation-audit-20261025/run-5').Path
$bench = (Resolve-Path -LiteralPath $EvidenceRoot).Path
if ($bench -ne $runDir) { throw "EvidenceRoot must be the frozen run-5 directory: $runDir" }
$harness = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/hyper-extract-v1').Path
$previous = (Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native').Path
$image = 'sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'
$inputBasePath = (Resolve-Path -LiteralPath '.local/thai-table-chunking-20261025/run-v2/native-input.json').Path
$nativeInputPath = (Resolve-Path -LiteralPath (Join-Path $runDir 'native-input.json')).Path
$freezePath = Join-Path $runDir 'freeze.json'
$candidatePath = Join-Path $runDir 'evidence-candidates.json'
$validationPath = Join-Path $runDir 'validated-evidence.json'
$projectionPath = Join-Path $runDir 'source-projection.json'
$out = Join-Path $bench 'native-evidence'
$arm = 'hyper-evidence'
$containerName = 'zuri-thai-hyper-evidence-v5'

foreach ($required in @($freezePath, $candidatePath, $validationPath, $projectionPath, $nativeInputPath, $inputBasePath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Missing run-5 artifact: $required" }
}
if (Test-Path -LiteralPath $out) { throw "Refusing to overwrite $out" }

$freezeHash = (Get-FileHash -LiteralPath $freezePath -Algorithm SHA256).Hash.ToLowerInvariant()
$candidateHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$freeze = Get-Content -LiteralPath $freezePath -Raw | ConvertFrom-Json
$candidate = Get-Content -LiteralPath $candidatePath -Raw | ConvertFrom-Json
$validation = Get-Content -LiteralPath $validationPath -Raw | ConvertFrom-Json
$projection = Get-Content -LiteralPath $projectionPath -Raw | ConvertFrom-Json
$nativeInput = Get-Content -LiteralPath $nativeInputPath -Raw | ConvertFrom-Json
$baseInput = Get-Content -LiteralPath $inputBasePath -Raw | ConvertFrom-Json

if ($freeze.runId -ne 'run-5' -or $candidate.runId -ne 'run-5' -or $candidate.status -ne 'COMPLETED') {
  throw 'Native run requires one completed, error-free frozen run-5 extraction'
}
if ($candidate.freezeSha256 -ne $freezeHash -or $validation.freezeSha256 -ne $freezeHash -or $projection.freezeSha256 -ne $freezeHash) {
  throw 'Candidate, validation, or projection freeze hash mismatch'
}
if (($candidate.sourceBundleSha256 -ne $freeze.source.sourceBundleSha256) -or
    ($validation.sourceBundleSha256 -ne $freeze.source.sourceBundleSha256) -or
    ($projection.sourceBundleSha256 -ne $freeze.source.sourceBundleSha256)) {
  throw 'Candidate, validation, or projection source bundle hash mismatch'
}
if ($validation.candidateReceiptSha256 -ne $candidateHash -or $projection.candidateReceiptSha256 -ne $candidateHash) {
  throw 'Validation/projection candidate receipt hash mismatch'
}
if ($validation.graphAdmission -notlike 'NONE;*' -or $validation.semanticStatus -ne 'NOT_ASSESSED') {
  throw 'Candidate graph must remain sidecar-only with semantic status NOT_ASSESSED'
}

$hyperArm = $nativeInput.arms | Where-Object parser -eq $arm | Select-Object -First 1
if (-not $hyperArm) { throw "Native input lacks $arm arm" }
if ($hyperArm.projection.freezeSha256 -ne $freezeHash -or $hyperArm.projection.candidateReceiptSha256 -ne $candidateHash) {
  throw 'Native arm does not bind the exact run-5 freeze and candidate receipt'
}
if ($hyperArm.projection.semanticStatus -ne 'NOT_ASSESSED' -or $hyperArm.projection.graphFieldsIncluded -ne $false) {
  throw 'Native arm must contain source text only and retain unassessed graph status'
}

function Get-Utf8Sha256([string]$Text) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToHexString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

if ((Get-Utf8Sha256 ([string]$hyperArm.content)) -ne $hyperArm.contentSha256) { throw 'Native arm content hash mismatch' }
if (((Get-Utf8Sha256 ([string]$projection.text)) -ne $projection.textSha256) -or
    ($hyperArm.projection.sourceTextSha256 -ne $projection.textSha256)) { throw 'Native arm projection hash mismatch' }
if (-not ([string]$hyperArm.content).EndsWith([string]$projection.text, [StringComparison]::Ordinal)) {
  throw 'Native arm does not end with the exact frozen source projection'
}

$sourceIds = @($freeze.chunkManifest | ForEach-Object { $_.sourceId })
foreach ($range in $hyperArm.ranges) {
  if ($sourceIds -notcontains [string]$range.doc) { throw "Native range maps to unknown document id: $($range.doc)" }
  if ($range.start -lt 0 -or $range.end -le $range.start -or $range.end -gt $hyperArm.content.Length) {
    throw "Native source range has invalid offsets: $($range.id)"
  }
  $rangeText = [string]$hyperArm.content.Substring([int]$range.start, [int]($range.end - $range.start))
  if ((Get-Utf8Sha256 $rangeText) -ne [string]$range.textSha256) { throw "Native source range hash mismatch: $($range.id)" }
}

foreach ($parser in @('plain', 'table')) {
  $before = $baseInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  $after = $nativeInput.arms | Where-Object parser -eq $parser | Select-Object -First 1
  if (-not $before -or -not $after -or $before.contentSha256 -ne $after.contentSha256 -or $before.content -cne $after.content) {
    throw "Frozen $parser arm changed while adding the budgeted evidence projection"
  }
}

New-Item -ItemType Directory -Path $out | Out-Null
$dockerArguments = @(
  'run', '--name', $containerName, '--network', 'none', '--cpus', '2', '--memory', '6g', '--memory-swap', '6g',
  '--mount', "type=bind,src=$out,dst=/bench",
  '--mount', "type=bind,src=$harness,dst=/harness,readonly",
  '--mount', "type=bind,src=$previous,dst=/previous,readonly",
  '--mount', "type=bind,src=$repo/apps/server/src,dst=/app/src,readonly",
  '--mount', "type=bind,src=$repo/apps/server/tests,dst=/app/tests,readonly",
  '--mount', "type=bind,src=$repo/apps/server/scripts,dst=/app/scripts,readonly",
  '--mount', "type=bind,src=$repo/apps/server/prisma/schema.prisma,dst=/app/prisma/schema.prisma,readonly",
  '--mount', "type=bind,src=$nativeInputPath,dst=/input/native-input.json,readonly",
  '--mount', 'type=volume,src=zuri-main-dev-20261020_ki17-model,dst=/model,readonly',
  '-e', "BENCH_ARM=$arm", '-e', 'KI17_MODEL_DIR=/model/614241f622f53c4eeff9890bdc4f31cfecc418b3',
  '--entrypoint', 'node', $image, '/harness/launch-native.mjs'
)
$dockerArguments | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bench 'native-evidence-command.json') -Encoding utf8
& docker @dockerArguments *> (Join-Path $bench 'native-evidence.log')
$runExit = $LASTEXITCODE
docker inspect --format '{{json .State}}' $containerName | Set-Content -LiteralPath (Join-Path $bench 'native-evidence-state.json') -Encoding utf8
docker cp "${containerName}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js')
Write-Output "hyper evidence native exit $runExit"
if ($runExit -ne 0) { exit $runExit }
