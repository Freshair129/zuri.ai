import { logDiagnostic } from '../safety/redact.js';

export interface CliSuccessResponse<T = unknown> {
  status: 'ok';
  contractVersion: '0.1.0b';
  data: T;
  timestamp: string;
}

export interface CliErrorResponse {
  status: 'error';
  contractVersion: '0.1.0b';
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

/**
 * Output JSON payload strictly to stdout.
 */
export function printJsonSuccess<T>(data: T): void {
  const payload: CliSuccessResponse<T> = {
    status: 'ok',
    contractVersion: '0.1.0b',
    data,
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

/**
 * Output JSON error payload strictly to stdout and diagnostic error to stderr.
 */
export function printJsonError(code: string, message: string, details?: unknown, exitCode = 1): void {
  logDiagnostic(`Error encountered: [${code}] ${message}`);
  const payload: CliErrorResponse = {
    status: 'error',
    contractVersion: '0.1.0b',
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(exitCode);
}
