'use client';

import { useState } from 'react';
import { api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { GatewayStatus } from '@/services/chat-gateway';

/**
 * Link a chat app (Nexconn, or any network behind the chat gateway). The code is shown once, here, inside
 * the person's own signed-in session; sending it from the chat account proves both ends belong to them.
 * The list updates by itself when the link is made from the phone.
 */
export function ChatLinks({ eventId, initial }: { eventId: string; initial: GatewayStatus }) {
  const { toast, confirm } = useFeedback();
  const { data, refresh } = useLive<GatewayStatus>(`/api/events/${eventId}/chat`, initial, 15_000);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const connected = data.transport.state === 'CONNECTED';

  const makeCode = async () => {
    setBusy(true);
    try {
      setCode(await api<{ code: string; expiresAt: number }>(`/api/events/${eventId}/chat`, 'POST', { action: 'code' }));
    } catch (error: unknown) {
      toast('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (linkId: string) => {
    if (!(await confirm({ title: 'Unlink this chat account?', body: 'HELLO stops sending notifications to it, and messages from it no longer act as you.', confirmLabel: 'Unlink' }))) return;
    try {
      await api(`/api/events/${eventId}/chat`, 'POST', { action: 'unlink', linkId });
      toast('success', 'Unlinked.');
      await refresh();
    } catch (error: unknown) {
      toast('error', errorText(error));
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className={connected ? 'notice notice--info' : data.transport.state === 'MISCONFIGURED' ? 'notice notice--error' : 'notice'} role="status" data-testid="chat-transport">
        <strong>{connected ? 'Chat network connected' : data.transport.state === 'MISCONFIGURED' ? 'Chat network misconfigured' : 'In-app only'}</strong>
        <p style={{ margin: '6px 0 0' }}>{data.transport.detail}</p>
      </div>
      {connected ? (
        <>
          <button type="button" className="button button--sm" disabled={busy} onClick={() => void makeCode()}>
            Link a chat app
          </button>
          {code ? (
            <p className="small" data-testid="chat-link-code">
              Send <code className="safety-number">LINK {code.code}</code> from your chat app within ten minutes. The code works once.
            </p>
          ) : null}
        </>
      ) : null}
      {data.links.length > 0 ? (
        <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0, margin: 0 }} data-testid="chat-links">
          {data.links.map((l) => (
            <li key={l.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">
                {l.transport} · {l.account}
              </span>
              <button type="button" className="button button--ghost button--sm" onClick={() => void unlink(l.id)}>
                Unlink
              </button>
            </li>
          ))}
        </ul>
      ) : connected ? (
        <p className="xs faint" style={{ margin: 0 }}>No chat app linked yet.</p>
      ) : null}
      {data.deliveries ? (
        <p className="xs faint" style={{ margin: 0 }} data-testid="chat-deliveries">
          Deliveries for this event: {data.deliveries.delivered} delivered · {data.deliveries.pending} waiting · {data.deliveries.failed} failed
        </p>
      ) : null}
    </div>
  );
}
