/* global fetch */
/**
 * Restores the demo to its seeded state. Reset is an organiser-only action, so this signs in as the
 * demo organiser first and sends that session with the request.
 */
export async function resetDemo(base) {
  const session = await fetch(`${base}/api/demo/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u-org-nadia' }),
  });
  const cookie = (session.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return fetch(`${base}/api/demo/reset`, { method: 'POST', headers: { cookie } });
}
