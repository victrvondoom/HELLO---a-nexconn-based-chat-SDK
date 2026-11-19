/**
 * Errors raised by domain rules. Each carries a stable `code` so API routes can
 * map it to a status without string matching.
 */
export type DomainErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'ALREADY_CLAIMED'
  | 'INELIGIBLE'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_NOT_DECIDABLE'
  | 'EXECUTION_NOT_ALLOWED'
  | 'RATE_LIMITED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** RATE_LIMITED only: seconds until the caller may retry. Sent as the HTTP Retry-After header. */
  readonly retryAfterSeconds: number | null;

  constructor(code: DomainErrorCode, message: string, options: { retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}
