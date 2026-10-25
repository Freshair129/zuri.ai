$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$raw = Join-Path $repo '.local/hyper-held-cell-audit-20261025'
$report = $PSScriptRoot
$summaryPath = Join-Path $report 'measurement-summary.json'
$summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
if ($summary.status -ne 'COMPLETED') { throw 'Measurement summary is not complete' }

$paths = @(
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/README.md',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/held-cell-audit.json',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/held-cell-audit.md',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/measurement-summary.json',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/build_held_cell_projection.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/derive_pdf_cell_values.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/evaluate-held-cell-native.mjs',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/extract_pdf_vector_geometry.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/held_cell_repair.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/native_chunk_boundary_probe.mjs',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/prepare_held_cells.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/run-native-held-cell-repair.ps1',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/seal-evidence-manifest.ps1',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/source_native_v2.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/test_held_cell_projection.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/test_held_cell_repair.py',
  'reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/test_pdf_cell_value_corrections.py',
  '.local/thai-native-20261025/input/economy.pdf',
  '.local/thai-native-20261025/input/population.pdf',
  '.local/thai-table-chunking-20261025/run-v2/native-input.json',
  '.local/hyper-relation-audit-20261025/run-5/source-bundle.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-enumeration-v1.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-freeze-v1.json',
  '.local/hyper-held-cell-audit-20261025/pdf-vector-geometry-v1.json',
  '.local/hyper-held-cell-audit-20261025/pdf-cell-value-evidence-v1.json',
  '.local/hyper-held-cell-audit-20261025/pdf-cell-value-freeze-v1.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2.json',
  '.local/hyper-held-cell-audit-20261025/held-cell-repair-projection-layout-v2-freeze.json',
  '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2.json',
  '.local/hyper-held-cell-audit-20261025/native-input-held-cell-repair-layout-v2-freeze.json',
  '.local/hyper-held-cell-audit-20261025/native-chunker-probe-layout-v2.json',
  '.local/hyper-held-cell-audit-20261025/native-host-preflight-source-pdf-repair-v1-layout-v2.json'
)

foreach ($armPath in @(
  '.local/hyper-held-cell-audit-20261025/native-table-current-attempt-1',
  '.local/hyper-held-cell-audit-20261025/native-source-pdf-repair-v1-attempt-2'
)) {
  foreach ($name in @('native-results.json', 'runtime-provenance.json', 'native-state.json', 'chunks.json', 'executed-native.test.js', 'native-launch-profile.json', 'native-command.json', 'stages.json', 'publication.json', 'native-run.log')) {
    $paths += "$armPath/$name"
  }
}

$entries = foreach ($relative in ($paths | Sort-Object -Unique)) {
  $absolute = Join-Path $repo ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "Missing evidence artifact: $relative" }
  $item = Get-Item -LiteralPath $absolute
  [ordered]@{
    path = $relative
    bytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$head = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not read repository HEAD' }
$manifest = [ordered]@{
  schema = 'zuri.hyper-held-cell-audit-evidence-manifest.v1'
  status = 'SEALED'
  baseRevision = $head
  measuredBaselineAttempt = 'native-table-current-attempt-1'
  measuredTreatmentAttempt = 'native-source-pdf-repair-v1-attempt-2'
  primaryInput = $summary.evidence.nativeInputSha256
  primaryProjection = $summary.evidence.repairProjectionSha256
  noQaChunkBoundaryProbe = $summary.evidence.noQaChunkBoundaryProbeSha256
  goldSha256 = $summary.evidence.goldSha256
  entries = @($entries)
}
$target = Join-Path $report 'evidence-manifest.json'
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $target -Encoding utf8
Write-Output "SEALED $target ($($entries.Count) files; HEAD $head)"
