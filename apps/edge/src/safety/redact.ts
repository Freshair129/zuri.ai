/**
// @req NFR-001 — the CLI never prints a token value, raw PII, raw SQL or a hidden group id.
// @req SEC-004 — secrets, access tokens and credentials are redacted rather than logged.
// @req SDD-008 — the safety module: redaction, validation and error mapping.

 * Redaction utility for diagnostic logging to stderr.
 * Prevents leaking secrets, tokens, PII, raw credentials, or raw group IDs.
 */

const SECRET_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.=]+/gi,
  /token[=:]\s*["']?[a-zA-Z0-9_\-\.=]+["']?/gi,
  /secret[=:]\s*["']?[a-zA-Z0-9_\-\.=]+["']?/gi,
  /password[=:]\s*["']?[^"'\s]+["']?/gi,
  /key[=:]\s*["']?[a-zA-Z0-9_\-\.=]+["']?/gi,
  /c[0-9a-f]{32}/gi, // raw LINE group ID pattern
  /u[0-9a-f]{32}/gi, // raw LINE user ID pattern
];

const RAW_LINE_ID_PATTERN = /^[cu][0-9a-f]{32}$/i;

/**
 * True if `value` looks like a raw LINE group/user ID (e.g. "C" or "U" followed by 32 hex
 * chars) rather than an owner-configured alias. Used to reject a raw LINE group ID wherever
 * only a server-resolved alias is an allowed authority field (see AGENTS.md permission matrix).
 */
export function isRawLineId(value: string): boolean {
  return RAW_LINE_ID_PATTERN.test(value.trim());
}

export function redactString(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

export function logDiagnostic(message: string, meta?: Record<string, unknown>): void {
  const sanitizedMsg = redactString(message);
  if (meta) {
    const sanitizedMeta = redactString(JSON.stringify(meta));
    process.stderr.write(`[DIAGNOSTIC] ${sanitizedMsg} ${sanitizedMeta}\n`);
  } else {
    process.stderr.write(`[DIAGNOSTIC] ${sanitizedMsg}\n`);
  }
}
