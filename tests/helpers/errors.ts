import { expect } from 'vitest';
import { DomainError, type DomainErrorCode } from '@/domain/errors';

/** Asserts that `fn` throws a DomainError with the given stable code. */
export function throwsCode(fn: () => unknown, code: DomainErrorCode): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect(caught instanceof DomainError ? caught.code : null).toBe(code);
}
