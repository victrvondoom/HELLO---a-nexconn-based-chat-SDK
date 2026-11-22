import type { NextResponse } from 'next/server';
import { jsonOk } from '@/lib/http';
import { closeSession } from '@/lib/session';

export async function POST(): Promise<NextResponse> {
  await closeSession();
  return jsonOk({ signedOut: true });
}

export const dynamic = 'force-dynamic';
