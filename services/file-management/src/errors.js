// @spec ADR-107 - typed public error boundary.
export class FileManagementError extends Error {
  constructor(code, status, message = code, details = undefined) {
    super(message)
    this.name = 'FileManagementError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function fail(code, status, message = code, details) {
  throw new FileManagementError(code, status, message, details)
}

export function asPublicError(error) {
  if (error instanceof FileManagementError) {
    return { status: error.status, code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
  }
  return { status: 503, code: 'FILE_SERVICE_UNAVAILABLE', message: 'File operation is temporarily unavailable' }
}
