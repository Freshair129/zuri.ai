param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
$repo=(Get-Location).Path
$bench=(Resolve-Path -LiteralPath $EvidenceRoot).Path
$harness=(Resolve-Path 'reports/oxr-thai-2026-10-25/table-chunking').Path
$previous=(Resolve-Path 'reports/oxr-thai-2026-10-25/real-native').Path
$image='sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39'
foreach($arm in @('plain','table')) {
  $out=Join-Path $bench "native-$arm"
  if(Test-Path -LiteralPath $out){throw "Refusing to overwrite $out"}
  New-Item -ItemType Directory -Path $out | Out-Null
  $name="zuri-thai-table-$arm-v2"
  $dockerArguments=@('run','--name',$name,'--network','none','--cpus','2','--memory','6g','--memory-swap','6g',
    '--mount',"type=bind,src=$out,dst=/bench",
    '--mount',"type=bind,src=$harness,dst=/harness,readonly",
    '--mount',"type=bind,src=$previous,dst=/previous,readonly",
    '--mount',"type=bind,src=$repo/apps/server/src,dst=/app/src,readonly",
    '--mount',"type=bind,src=$repo/apps/server/tests,dst=/app/tests,readonly",
    '--mount',"type=bind,src=$repo/apps/server/scripts,dst=/app/scripts,readonly",
    '--mount',"type=bind,src=$repo/apps/server/prisma/schema.prisma,dst=/app/prisma/schema.prisma,readonly",
    '--mount',"type=bind,src=$bench/native-input.json,dst=/input/native-input.json,readonly",
    '--mount','type=volume,src=zuri-main-dev-20261020_ki17-model,dst=/model,readonly',
    '-e',"BENCH_ARM=$arm",'-e','KI17_MODEL_DIR=/model/614241f622f53c4eeff9890bdc4f31cfecc418b3',
    '--entrypoint','node',$image,'/harness/launch-native.mjs')
  $dockerArguments | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $bench "$arm-command.json") -Encoding utf8
  & docker @dockerArguments *> (Join-Path $bench "native-$arm.log")
  $runExit=$LASTEXITCODE
  docker inspect --format '{{json .State}}' $name | Set-Content -LiteralPath (Join-Path $bench "native-$arm-state.json") -Encoding utf8
  docker cp "${name}:/app/experiment/native.test.js" (Join-Path $out 'executed-native.test.js')
  Write-Output "$arm native exit $runExit"
  if($runExit -ne 0){exit $runExit}
}
