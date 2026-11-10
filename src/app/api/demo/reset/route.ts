import type { NextResponse } from 'next/server';
import { demoModeEnabled } from '@/lib/session';
import { jsonError, jsonOk } from '@/lib/http';
import { resetRuntime } from '@/lib/runtime';

/**
 * Restores the seeded demo event to its starting state. Exists only in demo mode, and only
 * discards in-memory demo data. It cannot touch a real persistence layer, which does not exist yet.
 */
export function POST(): NextResponse {
  if (!demoModeEnabled()) {
    return jsonError('DISABLED', 'Demo reset is disabled in this deployment.', 404);
  }
  resetRuntime();
  return jsonOk({ reset: true });
}
