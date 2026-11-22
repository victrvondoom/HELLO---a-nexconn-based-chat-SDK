'use client';

/**
 * Browser side of Nexconn: initialise the Chat SDK with the public App Key, connect with a token the HELLO
 * server issued (POST /api/nexconn/token), and optionally initialise the Call SDK on the same connection.
 * The App Secret is never in this file or in any response it reads.
 *
 * The SDKs are loaded on demand, so pages that never use Nexconn do not download them.
 * API shapes verified against the installed type definitions: @nexconn/chat@26.5.1 (`NCEngine.initialize`,
 * `NCEngine.connect` -> NCResult<{ userId }>) and @nexconn/call@26.2.1 (`NCCallEngine.initialize`).
 */
export type NexconnConnection =
  | { connected: true; nexconnUserId: string; calls: boolean }
  | { connected: false; reason: string; message: string };

export async function connectNexconn(options: { calls?: boolean } = {}): Promise<NexconnConnection> {
  const response = await fetch('/api/nexconn/token', { method: 'POST' });
  const body = (await response.json()) as { ok: true; data: { appKey: string; area: string; token: string } } | { ok: false; error: { code: string; message: string } };
  if (!body.ok) return { connected: false, reason: body.error.code, message: body.error.message };

  const { NCEngine, AreaCode } = await import('@nexconn/chat');
  // The data centre is always explicit: the SDK's type definitions disagree about its default.
  const areaCode = AreaCode[body.data.area as keyof typeof AreaCode] as (typeof AreaCode)[keyof typeof AreaCode] | undefined;
  NCEngine.initialize({ appKey: body.data.appKey, ...(areaCode !== undefined ? { areaCode } : {}) });
  const result = await NCEngine.connect({ token: body.data.token });
  if (result.code !== 0 || !result.data) return { connected: false, reason: `NEXCONN_${result.code}`, message: 'Nexconn refused the connection.' };

  let calls = false;
  if (options.calls) {
    const { NCCallEngine } = await import('@nexconn/call');
    NCCallEngine.initialize({});
    calls = true;
  }
  return { connected: true, nexconnUserId: result.data.userId, calls };
}
