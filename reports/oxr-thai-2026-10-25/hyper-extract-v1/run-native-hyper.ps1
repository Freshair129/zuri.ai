param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$bench=(Resolve-Path -LiteralPath $EvidenceRoot).Path
$harness=(Resolve-Path 'reports/oxr-thai-2026-10-25/hyper-extract-v1').Path
$previous=(Resolve-Path 'reports/oxr-thai-2026-10-25/real-native').Path
$runDir=(Resolve-Path '.local/hyper-extract-20261025/run-3').Path
$image='sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'
$nativeInputPath=(Resolve-Path (Join-Path $runDir 'native-input.json')).Path
$arm='hyper'
$out=Join-Path $bench 'native-hyper'
if(Test-Path -LiteralPath $out){throw "Refusing to overwrite $out"}
$freezePath=Join-Path $runDir 'freeze.json'
$candidatePath=Join-Path $runDir 'candidates.json'
$validationPath=Join-Path $runDir 'validated-candidates.json'
$projectionPath=Join-Path $runDir 'source-projection.json'
foreach($required in @($freezePath,$candidatePath,$validationPath,$projectionPath,$nativeInputPath)){if(-not(Test-Path -LiteralPath $required)){throw "Missing run3 evidence artifact: $required"}}
$freezeHash=(Get-FileHash -LiteralPath $freezePath -Algorithm SHA256).Hash.ToLowerInvariant()
$candidateHash=(Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash.ToLowerInvariant()
$freeze=Get-Content -LiteralPath $freezePath -Raw | ConvertFrom-Json
$candidate=Get-Content -LiteralPath $candidatePath -Raw | ConvertFrom-Json
$validation=Get-Content -LiteralPath $validationPath -Raw | ConvertFrom-Json
$projection=Get-Content -LiteralPath $projectionPath -Raw | ConvertFrom-Json
if($freeze.runId -ne 'run-3' -or $candidate.status -ne 'COMPLETED'){throw 'Native run requires a completed frozen run3 extraction'}
if($candidate.freezeSha256 -ne $freezeHash -or $validation.freezeSha256 -ne $freezeHash){throw 'Candidate/validation freeze hash mismatch'}
if($validation.candidateReceiptSha256 -ne $candidateHash -or $projection.candidateReceiptSha256 -ne $candidateHash){throw 'Validation/projection candidate receipt hash mismatch'}
if($validation.sourceBundleSha256 -ne $freeze.sourceBundleSha256 -or $projection.sourceBundleSha256 -ne $freeze.sourceBundleSha256){throw 'Validation/projection source bundle hash mismatch'}
if($validation.graphAdmission -notlike 'NONE;*'){throw 'Candidate graph must remain sidecar-only'}
$nativeInput=Get-Content -LiteralPath $nativeInputPath -Raw | ConvertFrom-Json
$hyperArm=$nativeInput.arms | Where-Object parser -eq 'hyper' | Select-Object -First 1
if(-not $hyperArm -or $hyperArm.projection.freezeSha256 -ne $freezeHash -or $hyperArm.projection.candidateReceiptSha256 -ne $candidateHash){throw 'Native input does not bind the completed run3 freeze/candidate receipt'}
function GetUtf8Sha256([string]$Text){$hasher=[Security.Cryptography.SHA256]::Create();try{return [Convert]::ToHexString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()}finally{$hasher.Dispose()}}
if((GetUtf8Sha256 ([string]$hyperArm.content)) -ne $hyperArm.contentSha256){throw 'Native Hyper arm content hash mismatch'}
if((GetUtf8Sha256 ([string]$projection.text)) -ne $projection.textSha256 -or $hyperArm.projection.sourceTextSha256 -ne $projection.textSha256){throw 'Native projection text hash mismatch'}
if(-not ([string]$hyperArm.content).EndsWith([string]$projection.text,[StringComparison]::Ordinal)){throw 'Native Hyper arm does not end in the exact validated source projection'}
New-Item -ItemType Directory -Path $out | Out-Null
$name='zuri-thai-hyper-v1'
$dockerArguments=@('run','--name',$name,'--network','none','--cpus','2','--memory','6g','--memory-swap','6g',
  '--mount',"type=bind,src=$out,dst=/bench",
  '--mount',"type=bind,src=$harness,dst=/harness,readonly",
  '--mount',"type=bind,src=$previous,dst=/previous,readonly",
  '--mount',"type=bind,src=$repo/apps/server/src,dst=/app/src,readonly",
  '--mount',"type=bind,src=$repo/apps/server/tests,dst=/app/tests,readonly",
  '--mount',"type=bind,src=$repo/apps/server/scripts,dst=/app/scripts,readonly",
  '--mount',"type=bind,src=$repo/apps/server/prisma/schema.prisma,dst=/app/prisma/schema.prisma,readonly",
  '--mount',"type=bind,src=$nativeInputPath,dst=/input/native-input.json,readonly",
  '--mount','type=volume,src=zuri-main-dev-20261020_ki17-model,dst=/model,readonly',
  '-e',"BENCH_ARM=$arm",'-e','KI17_MODEL_DIR=/model/614241f622f53c4eeff9890bdc4f31cfecc418b3',
  '--entrypoint','node',$image,'/harness/launch-native.mjs')
$dockerArguments | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bench 'hyper-command.json') -Encoding utf8
& docker @dockerArguments *> (Join-Path $bench 'native-hyper.log')
$runExit=$LASTEXITCODE
docker inspect --format '{{json .State}}' $name | Set-Content -LiteralPath (Join-Path $bench 'native-hyper-state.json') -Encoding utf8
docker cp "${name}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js')
Write-Output "hyper native exit $runExit"
if($runExit -ne 0){exit $runExit}
