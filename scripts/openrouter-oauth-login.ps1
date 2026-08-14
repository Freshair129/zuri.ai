[CmdletBinding()]
param(
    [string]$Model = 'google/gemini-3.7-flash'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'windows-credential-store.ps1')

$credentialTarget = 'Zuri:OpenRouter:Phase1'
$exchange = $null
$authorizationCode = $null
$codeVerifierBytes = [byte[]]::new(48)
[Security.Cryptography.RandomNumberGenerator]::Fill($codeVerifierBytes)
$codeVerifier = [Convert]::ToBase64String($codeVerifierBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$challengeBytes = [Security.Cryptography.SHA256]::HashData([Text.Encoding]::ASCII.GetBytes($codeVerifier))
$codeChallenge = [Convert]::ToBase64String($challengeBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$query = [Web.HttpUtility]::ParseQueryString('')
$query['code_challenge'] = $codeChallenge
$query['code_challenge_method'] = 'S256'
$query['key_label'] = 'Zuri Phase 1 LINE'
$authorizationUrl = "https://openrouter.ai/auth?$($query.ToString())"

Write-Host 'Opening OpenRouter authorization. Paste the one-time code back into this window.'
Start-Process $authorizationUrl
$secureCode = Read-Host 'OpenRouter authorization code' -AsSecureString
$codePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCode)
try {
    $authorizationCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($codePointer)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($codePointer)
}
if ([string]::IsNullOrWhiteSpace($authorizationCode)) { throw 'OPENROUTER_AUTHORIZATION_CODE_REQUIRED' }

try {
    $exchangeBody = @{
        code = $authorizationCode.Trim()
        code_verifier = $codeVerifier
        code_challenge_method = 'S256'
    } | ConvertTo-Json -Compress
    $exchange = Invoke-RestMethod `
        -Method Post `
        -Uri 'https://openrouter.ai/api/v1/auth/keys' `
        -ContentType 'application/json' `
        -Body $exchangeBody
    if ([string]::IsNullOrWhiteSpace($exchange.key)) { throw 'OPENROUTER_KEY_MISSING' }

    $providerBody = @{
        model = $Model
        messages = @(@{ role = 'user'; content = 'ตอบเพียงคำว่า พร้อม' })
        max_tokens = 20
    } | ConvertTo-Json -Depth 5 -Compress
    $providerResult = Invoke-RestMethod `
        -Method Post `
        -Uri 'https://openrouter.ai/api/v1/chat/completions' `
        -Headers @{ Authorization = "Bearer $($exchange.key)" } `
        -ContentType 'application/json' `
        -Body $providerBody
    if (-not $providerResult.choices -or [string]::IsNullOrWhiteSpace($providerResult.choices[0].message.content)) {
        throw 'OPENROUTER_MODEL_CANARY_EMPTY'
    }

    [ZuriCredentialManager]::Write(
        $credentialTarget,
        'openrouter-oauth',
        $exchange.key,
        "Zuri Phase 1 OpenRouter OAuth key; model $Model"
    )
    [pscustomobject]@{
        provider = 'openrouter'
        model = $Model
        credentialTarget = $credentialTarget
        oauthExchange = 'PASS'
        modelCanary = 'PASS'
        bindingActivated = $false
    } | ConvertTo-Json -Compress
}
finally {
    $authorizationCode = $null
    $codeVerifier = $null
    if ($exchange) { $exchange.key = $null }
}
