import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cross-site request check for every state-changing API call.
 *
 * The session cookie is SameSite=Lax, which stops most cross-site POSTs. It does not stop a
 * sibling subdomain, which counts as "same site". So when a browser sends an Origin header, it must
 * match this host exactly. Requests without an Origin (server-to-server, tests) are left to the
 * normal checks.
 */
export function proxy(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return NextResponse.next();
  const origin = request.headers.get('origin');
  if (origin === null) return NextResponse.next();
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return reject();
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return host !== null && originHost === host ? NextResponse.next() : reject();
}

function reject() {
  return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Cross-site request refused.' } }, { status: 403 });
}

export const config = { matcher: '/api/:path*' };
