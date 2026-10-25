param([string]$EvidenceRoot='.local/thai-paddleocr-vl-20261025')
$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$raw=(Resolve-Path -LiteralPath $EvidenceRoot).Path
$report=(Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/paddleocr-vl-v1').Path
$harness=(Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/table-chunking').Path
$previous=(Resolve-Path -LiteralPath 'reports/oxr-thai-2026-10-25/real-native').Path
$planPath=Join-Path $raw 'native-evaluation-lock.json'
$plan=Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$planSha=(Get-Content -LiteralPath (Join-Path $raw 'native-evaluation-lock.sha256') -Raw).Trim().Split(' ')[0]
if((Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $planSha){throw 'Native evaluation lock digest mismatch.'}
$protocolPath=Join-Path $raw 'protocol.json'
$protocolSha=(Get-Content -LiteralPath (Join-Path $raw 'protocol.sha256') -Raw).Trim().Split(' ')[0]
if((Get-FileHash -LiteralPath $protocolPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $protocolSha -or $protocolSha -ne $plan.protocolSha256){throw 'Frozen experiment protocol mismatch.'}
$runnerSha=(Get-FileHash -LiteralPath (Join-Path $report 'run-native-vl.ps1') -Algorithm SHA256).Hash.ToLowerInvariant()
if($runnerSha -ne $plan.native.runnerSha256){throw 'Native evaluation runner changed after the plan was frozen.'}
$lockPath=Join-Path $raw 'harness-lock.json'
$lock=Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
$lockSha=(Get-Content -LiteralPath (Join-Path $raw 'harness-lock.sha256') -Raw).Trim().Split(' ')[0]
if((Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lockSha -or $lockSha -ne $plan.harnessLockSha256){throw 'Frozen OCR harness lock mismatch.'}
$amendmentPath=Join-Path $raw 'protocol-amendment.json'
$amendmentSha=(Get-Content -LiteralPath (Join-Path $raw 'protocol-amendment.sha256') -Raw).Trim().Split(' ')[0]
if((Get-FileHash -LiteralPath $amendmentPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $amendmentSha -or $amendmentSha -ne $plan.protocolAmendmentSha256){throw 'Frozen protocol amendment mismatch.'}
foreach($source in $lock.scripts){
 $sourcePath=Join-Path $repo $source.path
 if(-not (Test-Path -LiteralPath $sourcePath)){throw "Frozen source is missing: $($source.path)"}
 $actual=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actual -ne $source.sha256){throw "Frozen source changed: $($source.path)"}
}
$candidateInput=Join-Path $raw 'native-input.json'
$candidateProjection=Join-Path $raw 'projected.json'
$candidateSidecar=Join-Path $raw 'table-sidecar.json'
$inferenceFreezePath=Join-Path $raw 'inference-freeze.json'
foreach($item in @(
 @{Path=$candidateInput;Expected=$plan.candidate.nativeInputSha256},
 @{Path=$candidateProjection;Expected=$plan.candidate.projectedJsonSha256},
 @{Path=$candidateSidecar;Expected=$plan.candidate.tableSidecarSha256},
 @{Path=$inferenceFreezePath;Expected=$plan.candidate.inferenceFreezeSha256}
)){
 $actual=(Get-FileHash -LiteralPath $item.Path -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actual -ne $item.Expected){throw "Frozen candidate evaluation input changed: $($item.Path)"}
}
$docker=(Get-Command docker.exe -CommandType Application | Select-Object -First 1).Source
$image=[string]$plan.native.image
$imageInfo=& $docker image inspect $image --format '{{.Id}} {{.Size}} {{json .RepoDigests}}'
if($LASTEXITCODE -ne 0){throw 'Pinned GenesisRAG17 image is not available locally.'}
$modelVolume='zuri-main-dev-20261020_ki17-model'
foreach($arm in @('plain','table')){
 $expectedArm=$plan.candidate.arms | Where-Object parser -eq $arm
 if(-not $expectedArm){throw "Candidate arm is not frozen: $arm"}
 $out=Join-Path $raw "native-vl-$arm"
 if(Test-Path -LiteralPath $out){throw "Refusing to overwrite native output $out"}
 New-Item -ItemType Directory -Path $out | Out-Null
 $name="zuri-thai-vl-v1-$arm-a1"
 & $docker container inspect $name *> $null
 if($LASTEXITCODE -eq 0){throw "Container name already exists: $name"}
 $dockerArguments=@('run','--name',$name,'--network','none','--cpus','2','--memory','6g','--memory-swap','6g',
  '--mount',"type=bind,src=$out,dst=/bench",
  '--mount',"type=bind,src=$harness,dst=/harness,readonly",
  '--mount',"type=bind,src=$previous,dst=/previous,readonly",
  '--mount',"type=bind,src=$repo/apps/server/src,dst=/app/src,readonly",
  '--mount',"type=bind,src=$repo/apps/server/tests,dst=/app/tests,readonly",
  '--mount',"type=bind,src=$repo/apps/server/scripts,dst=/app/scripts,readonly",
  '--mount',"type=bind,src=$repo/apps/server/prisma/schema.prisma,dst=/app/prisma/schema.prisma,readonly",
  '--mount',"type=bind,src=$candidateInput,dst=/input/native-input.json,readonly",
  '--mount',"type=volume,src=$modelVolume,dst=/model,readonly",
  '-e',"BENCH_ARM=$arm",'-e','KI17_MODEL_DIR=/model/614241f622f53c4eeff9890bdc4f31cfecc418b3',
  '--entrypoint','node',$image,'/harness/launch-native.mjs')
 @($dockerArguments) | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'docker-arguments.json') -Encoding utf8
 $started=[DateTimeOffset]::UtcNow
 & $docker @dockerArguments *> (Join-Path $out 'native-run.log')
 $exitCode=$LASTEXITCODE
 $ended=[DateTimeOffset]::UtcNow
 & $docker inspect --format '{{json .State}}' $name | Set-Content -LiteralPath (Join-Path $out 'container-state.json') -Encoding utf8
 $cpOutput=& $docker cp "${name}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js') 2>&1
 $cpExit=$LASTEXITCODE
 if($cpExit -ne 0){$cpOutput | Set-Content -LiteralPath (Join-Path $out 'native-test-copy-error.txt') -Encoding utf8}
 $state=[ordered]@{arm=$arm;container=$name;image=$image;imageInspect=($imageInfo -join ' ');startedAt=$started.ToString('o');endedAt=$ended.ToString('o');elapsedMs=($ended-$started).TotalMilliseconds;exitCode=$exitCode;nativeTestCopyExit=$cpExit;cpOutput=($cpOutput -join "`n");network='none';cpu=2;memoryBytes=6442450944;modelVolume=$modelVolume;nativeEvaluationLockSha256=$planSha;harnessLockSha256=$lockSha}
 $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'run-state.json') -Encoding utf8
 Write-Output "$arm GenesisRAG17 exit=$exitCode elapsed=$([math]::Round(($ended-$started).TotalSeconds,1))s raw=$out"
 if($exitCode -ne 0){throw "GenesisRAG17 $arm arm failed; preserved $out"}
}
