import { NextResponse } from 'next/server';
import { DomainError, type DomainErrorCode } from '@/domain/errors';
import { logError } from './logger';

/** Every API response uses this envelope. Clients branch on `ok`, never on message text. */
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function jsonOk<T>(data: T, status = 200): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  ALREADY_CLAIMED: 409,
  INELIGIBLE: 409,
  APPROVAL_REQUIRED: 409,
  APPROVAL_NOT_DECIDABLE: 409,
  EXECUTION_NOT_ALLOWED: 409,
  RATE_LIMITED: 429,
};

export function jsonError(code: string, message: string, status: number): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** Maps domain errors to stable HTTP responses. Anything else is logged and hidden from the client. */
export function errorResponse(error: unknown, route: string): NextResponse<ApiEnvelope<never>> {
  if (error instanceof DomainError) {
    return jsonError(error.code, error.message, STATUS_BY_CODE[error.code]);
  }
  logError('unhandled_api_error', { route, detail: error instanceof Error ? error.message : 'unknown' });
  return jsonError('INTERNAL', 'Something went wrong. Please try again.', 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'The request body must be JSON.');
  }
}
