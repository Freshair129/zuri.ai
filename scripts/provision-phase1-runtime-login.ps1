[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-credential-store.ps1')

$projectRef = 'qcnmhyglarzcpudjorzc'
$databaseRole = 'zuri_line_smartgift_login'
$credentialTarget = "Zuri:Supabase:${projectRef}:RuntimeUrl"
$adminUrl = $null
$runtimeUrl = $null
$password = $null

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-UrlSafeSecret {
    $bytes = [byte[]]::new(36)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    }
    finally {
        $generator.Dispose()
    }
}

try {
    Write-Host 'Paste the Supabase Postgres connection string for project qcnmhyglarzcpudjorzc.'
    Write-Host 'Use the postgres owner connection from the dashboard Connect dialog; input is hidden.'
    $secureAdminUrl = Read-Host 'Admin database connection string' -AsSecureString
    $adminUrl = ConvertFrom-SecureValue $secureAdminUrl
    if ([string]::IsNullOrWhiteSpace($adminUrl)) { throw 'ADMIN_DATABASE_CONNECTION_STRING_REQUIRED' }

    $password = New-UrlSafeSecret
    $uri = [Uri]$adminUrl
    $adminUser = [Uri]::UnescapeDataString($uri.UserInfo.Split(':')[0])
    $isDirect = $uri.Host -eq "db.$projectRef.supabase.co" -and $adminUser -eq 'postgres'
    $isPooler = $uri.Host.EndsWith('.pooler.supabase.com') -and $adminUser -eq "postgres.$projectRef"
    if (-not $isDirect -and -not $isPooler) { throw 'ADMIN_DATABASE_PROJECT_OR_ROLE_FORBIDDEN' }

    $builder = [UriBuilder]$uri
    $builder.UserName = if ($isPooler) { "$databaseRole.$projectRef" } else { $databaseRole }
    $builder.Password = $password
    $builder.Query = ''
    $runtimeUrl = $builder.Uri.AbsoluteUri

    [ZuriCredentialManager]::Write(
        $credentialTarget,
        $databaseRole,
        $runtimeUrl,
        'Zuri Phase 1 tenant-isolated Supabase runtime connection'
    )

    $env:ZURI_ADMIN_DB_URL = $adminUrl
    $env:ZURI_RUNTIME_DB_PASSWORD = $password
    try {
        & node scripts/provision-phase1-runtime-login.mjs
        if ($LASTEXITCODE -ne 0) { throw "PHASE1_RUNTIME_PROVISION_FAILED:$LASTEXITCODE" }
    }
    finally {
        Remove-Item Env:\ZURI_ADMIN_DB_URL -ErrorAction SilentlyContinue
        Remove-Item Env:\ZURI_RUNTIME_DB_PASSWORD -ErrorAction SilentlyContinue
    }

    [pscustomobject]@{
        projectRef = $projectRef
        credentialTarget = $credentialTarget
        runtimeLogin = $databaseRole
        livePermissionProbe = 'PASS'
        bindingActivated = $false
    } | ConvertTo-Json -Compress
}
finally {
    $adminUrl = $null
    $runtimeUrl = $null
    $password = $null
}
