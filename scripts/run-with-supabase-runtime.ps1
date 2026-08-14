[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$BatchPath
)

# @req FR-054 — Windows startup injects the dedicated Supabase URL without persisting it in files.
# @spec SDD-027, SEC-011 — validate the exact target and keep the credential process-local.
# @tested tests/unit/run-bat-database-bootstrap.test.js

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRef = 'qcnmhyglarzcpudjorzc'
$runtimeRole = 'zuri_line_smartgift_login'
$credentialTarget = "Zuri:Supabase:${projectRef}:RuntimeUrl"
$expectedPoolerUser = "${runtimeRole}.${projectRef}"
$expectedPoolerHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$resolvedBatch = [IO.Path]::GetFullPath($BatchPath)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$caFile = [IO.Path]::GetFullPath((Join-Path $repoRoot 'certs\supabase-prod-ca-2021.crt'))

if (-not $resolvedBatch.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'ZURI_RUNTIME_BATCH_OUTSIDE_REPOSITORY'
}
if (-not (Test-Path -LiteralPath $caFile -PathType Leaf)) {
    throw 'ZURI_RUNTIME_CA_MISSING'
}

if (-not ('ZuriRuntimeCredentialReader' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ZuriRuntimeCredentialReader
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public UInt32 Flags;
        public UInt32 Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    public static string ReadSecret(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, 1, 0, out pointer)) return null;
        try
        {
            CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
            return Marshal.PtrToStringUni(
                credential.CredentialBlob,
                (int)credential.CredentialBlobSize / sizeof(char)
            );
        }
        finally
        {
            CredFree(pointer);
        }
    }
}
'@
}

$runtimeUrl = [ZuriRuntimeCredentialReader]::ReadSecret($credentialTarget)
if ($runtimeUrl) {
    try {
        $uri = [Uri]$runtimeUrl
    }
    catch {
        throw 'ZURI_RUNTIME_CREDENTIAL_URL_INVALID'
    }
    if ($uri.Scheme -notin @('postgres', 'postgresql') -or
        $uri.UserInfo.Split(':')[0] -ne $expectedPoolerUser -or
        $uri.Host -ne $expectedPoolerHost -or
        $uri.Port -ne 5432 -or
        $uri.AbsolutePath -ne '/postgres') {
        throw 'ZURI_RUNTIME_CREDENTIAL_TARGET_FORBIDDEN'
    }

    $env:ZURI_LINE_DB_URL = $runtimeUrl
    $env:ZURI_LINE_DB_CA_FILE = $caFile
    $env:ZURI_LINE_ISOLATION_TENANT_ID = '77cdbe70-3111-4a04-922a-8059be99a8b0'
    $env:ZURI_LINE_ISOLATION_BUSINESS_ID = '834fa869-62f3-431c-a287-e9a95e91175b'
    $env:ZURI_LINE_ISOLATION_CROSS_TENANT_ID = 'ef2552ce-ff10-4b1f-8212-d0a729f5a159'
    Write-Host '[zuri] Supabase runtime credential loaded from Windows Credential Manager.'
}
else {
    Write-Host '[zuri] Supabase runtime credential is not installed; continuing with local SQLite only.'
}

$env:ZURI_SUPABASE_RUNTIME_BOOTSTRAPPED = '1'
try {
    & $env:ComSpec '/d' '/c' ('"' + $resolvedBatch + '"')
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:\ZURI_LINE_DB_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\ZURI_LINE_DB_CA_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:\ZURI_LINE_ISOLATION_TENANT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\ZURI_LINE_ISOLATION_BUSINESS_ID -ErrorAction SilentlyContinue
    Remove-Item Env:\ZURI_LINE_ISOLATION_CROSS_TENANT_ID -ErrorAction SilentlyContinue
    $runtimeUrl = $null
}
