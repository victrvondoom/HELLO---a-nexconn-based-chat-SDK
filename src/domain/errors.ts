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

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
