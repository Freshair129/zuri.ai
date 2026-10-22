# @req FR-289 — restrict deployment file selectors to literal, reviewable paths.
# @tested tests/unit/knowledge-studio/docker-runtime.test.js
function Get-ComposePathSelector([string]$rawValue, [string]$variableName) {
  $value = $rawValue.Trim()
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }

  if ($value.StartsWith('"') -or $value.StartsWith("'")) {
    $quoted = [regex]::Match($value, '^(["''])(.*?)\1(?:\s+#.*)?$')
    if (-not $quoted.Success) {
      throw "[zuri] $variableName must be a quoted path followed only by an optional inline comment."
    }
    $quote = $quoted.Groups[1].Value
    $path = $quoted.Groups[2].Value
    if ($quote -eq '"' -and $path.Contains('$')) {
      throw "[zuri] $variableName must use a literal path; Compose variable interpolation is unsupported for deployment selectors."
    }
    return $path
  }

  $path = [regex]::Replace($value, '\s+#.*$', '').Trim()
  if ($path.Contains('"') -or $path.Contains("'")) {
    throw "[zuri] $variableName must use a balanced quoted path when the value contains quote characters."
  }
  if ($path.Contains('$')) {
    throw "[zuri] $variableName must use a literal path; Compose variable interpolation is unsupported for deployment selectors."
  }
  return $path
}
