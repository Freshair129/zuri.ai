param(
 [Parameter(Mandatory=$true)][ValidateSet('bootstrap','inference')][string]$Phase,
 [string]$Attempt='1'
)
$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$raw=(Resolve-Path '.local/thai-paddleocr-vl-20261025').Path
$harness=(Resolve-Path 'reports/oxr-thai-2026-10-25/paddleocr-vl-v1').Path
$inputDirectory=(Resolve-Path '.local/thai-native-20261025/input').Path
$protocol=Get-Content -LiteralPath (Join-Path $raw 'protocol.json') -Raw | ConvertFrom-Json
$expectedProtocol=(Get-Content -LiteralPath (Join-Path $raw 'protocol.sha256') -Raw).Trim().Split(' ')[0]
$protocolHash=(Get-FileHash -LiteralPath (Join-Path $raw 'protocol.json') -Algorithm SHA256).Hash.ToLowerInvariant()
if($protocolHash -ne $expectedProtocol){throw 'Frozen protocol hash mismatch.'}
$harnessLock=$null
if($Phase -eq 'inference'){
 $lockPath=Join-Path $raw 'harness-lock.json'
 $amendmentPath=Join-Path $raw 'protocol-amendment.json'
 $lock=$null
 try{$lock=Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json}catch{throw 'Pre-inference harness lock is missing.'}
 $lockSha=(Get-Content -LiteralPath (Join-Path $raw 'harness-lock.sha256') -Raw).Trim().Split(' ')[0]
 $actualLockSha=(Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash.ToLowerInvariant()
 if($lockSha -ne $actualLockSha){throw 'Harness lock hash mismatch.'}
 $amendment=Get-Content -LiteralPath $amendmentPath -Raw | ConvertFrom-Json
 $expectedAmendment=(Get-Content -LiteralPath (Join-Path $raw 'protocol-amendment.sha256') -Raw).Trim().Split(' ')[0]
 $actualAmendment=(Get-FileHash -LiteralPath $amendmentPath -Algorithm SHA256).Hash.ToLowerInvariant()
 if($expectedAmendment -ne $actualAmendment -or $amendment.pinnedHarness.sha256 -ne $actualLockSha){throw 'Pre-inference protocol amendment or harness lock does not match.'}
 if($lock.status -ne 'frozen-before-inference' -or $lock.protocolSha256 -ne $expectedProtocol){throw 'Pre-inference harness lock does not bind to protocol v1.'}
 foreach($script in $lock.scripts){
  $scriptPath=Join-Path $repo $script.path
  if(-not (Test-Path -LiteralPath $scriptPath)){throw "Frozen harness source missing: $($script.path)"}
  $scriptSha=(Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if($scriptSha -ne $script.sha256){throw "Frozen harness source changed: $($script.path)"}
 }
 $harnessLock=$lockSha
}
$image=$protocol.candidate.container
$dockerCommand=Get-Command docker.exe -CommandType Application | Select-Object -First 1
if(-not $dockerCommand){throw 'docker.exe was not found.'}
$docker=$dockerCommand.Source
$name="zuri-thai-paddleocr-vl-$Phase-v1-a$Attempt"
$out=if($Phase -eq 'bootstrap'){Join-Path $raw "bootstrap/attempt-$Attempt"}else{Join-Path $raw "inference/attempt-$Attempt"}
if(Test-Path -LiteralPath $out){throw "Refusing to overwrite prior attempt $out"}
New-Item -ItemType Directory -Path $out | Out-Null
$containerOutput=Join-Path $out 'model-output'
New-Item -ItemType Directory -Path $containerOutput | Out-Null
docker image inspect $image *> (Join-Path $out 'image-inspect.log')
if($LASTEXITCODE -ne 0){throw 'Pinned PaddleOCR-VL image is not available locally.'}
& docker container inspect $name *> $null
if($LASTEXITCODE -eq 0){throw "Container name already exists: $name"}
$cache=Join-Path $raw 'model-cache'
$dockerArguments=@('run','--name',$name,'--gpus','all','--cpus','6','--memory','12g','--memory-swap','12g',
 '--mount',"type=bind,src=$containerOutput,dst=/out",
 '--mount',"type=bind,src=$harness,dst=/harness,readonly",
 '-e','CUDA_VISIBLE_DEVICES=0')
$manifestSha=$null;$verifiedModelFiles=0
if($Phase -eq 'bootstrap'){
 # The bootstrap container has no PDF, gold, query, scorer, previous-run, or application mount.
 $dockerArguments+=@('--network','bridge','--mount',"type=bind,src=$cache,dst=/home/paddleocr/.paddlex",'--entrypoint','python',$image,'/harness/bootstrap-vl.py')
}else{
 $cacheManifest=Get-Content -LiteralPath (Join-Path $raw 'model-cache-manifest.json') -Raw | ConvertFrom-Json
 if($cacheManifest.status -ne 'frozen-before-inference' -or $cacheManifest.files.Count -lt 1){throw 'Frozen model cache manifest is missing or empty.'}
 $manifestPath=Join-Path $raw 'model-cache-manifest.json'
 $manifestSha=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
 if($manifestSha -ne $lock.modelCacheManifestSha256){throw 'Model cache manifest differs from the frozen harness lock.'}
 $expectedFiles=@($cacheManifest.files)
 $expectedByPath=[System.Collections.Generic.Dictionary[string,object]]::new([System.StringComparer]::Ordinal)
 foreach($entry in $expectedFiles){$expectedByPath.Add([string]$entry.path,$entry)}
 $cacheItems=@(Get-ChildItem -LiteralPath $cache -Force -Recurse)
 if(@($cacheItems | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint }).Count -gt 0){throw 'Model cache contains a reparse point.'}
 $actualFiles=@($cacheItems | Where-Object { -not $_.PSIsContainer })
 if($actualFiles.Count -ne $expectedFiles.Count){throw "Model cache file count mismatch: expected $($expectedFiles.Count), found $($actualFiles.Count)."}
 foreach($file in $actualFiles){
  $relative=[System.IO.Path]::GetRelativePath($cache,$file.FullName).Replace('\','/')
  if(-not $expectedByPath.ContainsKey($relative)){throw "Unexpected model cache file: $relative"}
  $entry=$expectedByPath[$relative]
  if($file.Length -ne $entry.bytes){throw "Model cache size changed: $relative"}
  $fileSha=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if($fileSha -ne $entry.sha256){throw "Model cache digest changed: $relative"}
 }
 $verifiedModelFiles=$actualFiles.Count
 $dockerArguments+=@('--network','none','--mount',"type=bind,src=$inputDirectory,dst=/input,readonly",'--mount',"type=bind,src=$cache,dst=/home/paddleocr/.paddlex,readonly",
  '-e',"ECONOMY_SHA256=$($protocol.inputs.pdfs | Where-Object id -eq 'economy' | Select-Object -ExpandProperty sha256)",
  '-e',"POPULATION_SHA256=$($protocol.inputs.pdfs | Where-Object id -eq 'population' | Select-Object -ExpandProperty sha256)",
  '--entrypoint','python',$image,'/harness/run-vl.py')
}
@($dockerArguments) | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'docker-arguments.json') -Encoding utf8
$stdout=Join-Path $out 'stdout.log';$stderr=Join-Path $out 'stderr.log';$gpuCsv=Join-Path $out 'gpu-samples.csv'
Set-Content -LiteralPath $gpuCsv -Value 'sampled_at_utc,name,memory_total_mib,memory_used_mib,utilization_gpu_percent' -Encoding ascii
$start=[DateTimeOffset]::UtcNow
$gpuQuery=@('--query-gpu=name,memory.total,memory.used,utilization.gpu','--format=csv,noheader,nounits')
try{
 $process=Start-Process -FilePath $docker -ArgumentList $dockerArguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}catch{
 $_ | Out-String | Set-Content -LiteralPath (Join-Path $out 'launcher-failure.txt') -Encoding utf8
 throw
}
try{
 while($true){
  $stamp=[DateTimeOffset]::UtcNow.ToString('o')
  $rows=& nvidia-smi @gpuQuery 2>$null
  foreach($row in $rows){Add-Content -LiteralPath $gpuCsv -Value "$stamp,$row" -Encoding ascii}
  $process.Refresh();if($process.HasExited){break};Start-Sleep -Seconds 1
 }
 $process.WaitForExit();$exitCode=$process.ExitCode
}finally{
 $process.Refresh()
 if(-not $process.HasExited){Stop-Process -Id $process.Id -Force;throw 'Docker process was interrupted; inspect this preserved attempt.'}
}
$end=[DateTimeOffset]::UtcNow
docker inspect --format '{{json .State}}' $name | Set-Content -LiteralPath (Join-Path $out 'container-state.json') -Encoding utf8
docker image inspect $image --format '{{.Id}} {{.Size}} {{json .RepoDigests}}' | Set-Content -LiteralPath (Join-Path $out 'image-pinned.json') -Encoding utf8
$runState=[ordered]@{phase=$Phase;attempt=$Attempt;container=$name;image=$image;startedAt=$start.ToString('o');endedAt=$end.ToString('o');elapsedMs=($end-$start).TotalMilliseconds;exitCode=$exitCode;network=if($Phase -eq 'bootstrap'){'bridge; no PDF input'}else{'none'};harnessLockSha256=$harnessLock;modelCacheManifestSha256=$manifestSha;modelCacheFilesVerified=$verifiedModelFiles;gpuSamples=(Get-Content -LiteralPath $gpuCsv | Measure-Object -Line).Lines-1}
$runState | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'run-state.json') -Encoding utf8
if($exitCode -ne 0){throw "$Phase container exited $exitCode; preserved $out"}
Write-Output "$Phase container completed in $([math]::Round(($runState.elapsedMs / 1000),1))s; GPU samples=$($runState.gpuSamples); raw=$out"
