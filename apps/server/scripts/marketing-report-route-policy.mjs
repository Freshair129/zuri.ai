// @spec SDD-112, ADR-115 — lexical recognition of the existing dedicated machine-principal route.
// @tested tests/node/compact-workflow.test.mjs
// This is a narrow preflight compatibility check, not runtime authorization proof.
export function isMarketingReportMachineReceiver(file, body) {
  if (file !== 'src/app/api/growth/external-marketing-reports/route.js' || typeof body !== 'string') return false
  const imports = [
    /import\s+\{[^}]*\breportCredentialHash\b[^}]*\breadMarketingReportRequest\b[^}]*\}\s+from\s+['"]@\/modules\/marketing\/application\/marketing-report-wire['"]/,
    /import\s+\{\s*receiveMarketingReport\s*\}\s+from\s+['"]@\/modules\/marketing\/application\/marketing-report-receiver['"]/,
    /import\s+\{\s*resolveMarketingReportDatabase\s*\}\s+from\s+['"]@\/modules\/marketing\/infrastructure\/marketing-report-database['"]/,
  ]
  if (!imports.every(pattern => pattern.test(body))) return false
  const ordered = [
    /const\s+authorization\s*=\s*request\.headers\.get\(['"]authorization['"]\)/,
    /reportCredentialHash\(authorization\)/,
    /const\s*\{\s*canonicalEnvelope\s*\}\s*=\s*await\s+readMarketingReportRequest\(request\)/,
    /const\s+selected\s*=\s*resolveMarketingReportDatabase\(\)/,
    /await\s+receiveMarketingReport\(\{\s*db:\s*selected\?\.db,\s*provider:\s*selected\?\.provider,\s*authorization,\s*raw:\s*canonicalEnvelope\s*\}\)/,
  ].map(pattern => body.search(pattern))
  return ordered.every((position, index) => position >= 0 && (index === 0 || position > ordered[index - 1]))
}
