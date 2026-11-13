'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatMoney } from '@/domain/payments/voice';
import type { Payment } from '@/domain/types';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type Ctor = new () => SpeechRecognitionLike;
function speech(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { message: string } };
interface Thread {
  gateway: { name: string; live: boolean };
  payments: Payment[];
}

const STATUS: Record<Payment['status'], string> = {
  AWAITING_CONFIRMATION: 'Waiting for you to confirm',
  SUCCEEDED: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/**
 * Pay the person you are chatting with. Speaking (or typing) only drafts the payment;
 * the Confirm button is what authorises it, because a voice can be overheard or replayed.
 */
export function PayPanel({ eventId, me, peer }: { eventId: string; me: string; peer: { id: string; name: string } }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  const load = useCallback(async () => {
    try {
      const body = (await (await fetch(`/api/events/${eventId}/pay/${peer.id}`, { cache: 'no-store' })).json()) as Envelope<Thread>;
      if (body.ok) setThread(body.data);
    } catch {
      /* the next poll retries */
    }
  }, [eventId, peer.id]);

  useEffect(() => {
    setCanSpeak(speech() !== null);
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => {
      window.clearInterval(id);
      recognition.current?.stop();
    };
  }, [load]);

  async function post<T>(url: string, payload: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = (await response.json()) as Envelope<T>;
      if (!body.ok) {
        setError(body.error.message);
        return null;
      }
      return body.data;
    } catch {
      setError('The connection failed. Nothing was charged.');
      return null;
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function draft(utterance: string, origin: 'VOICE' | 'TYPED') {
    if (utterance.trim().length < 3) return;
    if (await post<Payment>(`/api/events/${eventId}/pay/${peer.id}`, { utterance, origin })) setText('');
  }

  function listen() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const C = speech();
    if (!C) return;
    const r = new C();
    r.lang = document.documentElement.lang || 'en-IN';
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (event) => {
      const spoken = Array.from(event.results, (x) => x[0]?.transcript ?? '').join(' ').trim();
      if (spoken) void draft(spoken, 'VOICE');
    };
    r.onerror = () => {
      setError('I could not hear that. You can type the amount instead.');
    };
    r.onend = () => {
      setListening(false);
    };
    recognition.current = r;
    setError(null);
    setListening(true);
    r.start();
  }

  const decide = (p: Payment, action: 'confirm' | 'cancel') => post<Payment>(`/api/events/${eventId}/payments/${p.id}`, { action, expectedVersion: p.version });
  const live = thread?.gateway.live ?? false;

  return (
    <section className="card pay" aria-label={`Pay ${peer.name}`}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong>Pay {peer.name}</strong>
        <span className={live ? 'badge' : 'badge badge--warning'}>{live ? 'Live payments' : 'Sandbox · no real money moves'}</span>
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void draft(text, 'TYPED');
        }}
      >
        <label htmlFor="pay-text" className="visually-hidden">
          Say or type a payment
        </label>
        <input id="pay-text" value={text} maxLength={300} onChange={(e) => {
            setText(e.target.value);
          }} placeholder="“Pay 200 rupees for lunch”" disabled={busy} />
        {canSpeak ? (
          <button type="button" className="mic-button" onClick={listen} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Say the payment'} disabled={busy}>
            <Icon name="mic" />
          </button>
        ) : null}
        <button type="submit" className="button" disabled={busy || text.trim().length < 3}>
          Review
        </button>
      </form>
      <span className="xs faint">Speaking only prepares the payment. Nothing is sent until you press Confirm.</span>
      {error ? (
        <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      ) : null}
      <ul className="list-reset stack" style={{ gap: 8 }} aria-live="polite">
        {(thread?.payments ?? []).slice(-5).reverse().map((p) => {
          const mine = p.payerId === me;
          const amount = formatMoney(p.amountMinor, p.currency);
          return (
            <li key={p.id} className={p.status === 'AWAITING_CONFIRMATION' ? 'ocard ocard--approval' : 'ocard'}>
              <span className="ocard__title">
                {mine ? `${amount} to ${peer.name}` : `${amount} from ${peer.name}`}
                {p.note ? ` · ${p.note}` : ''}
              </span>
              <span className="ocard__meta">
                {mine || p.status !== 'SUCCEEDED' ? STATUS[p.status] : 'Received'}
                {p.failureReason ? `: ${p.failureReason}` : ''}
                {p.providerRef ? ` · ref ${p.providerRef}` : ''}
              </span>
              {mine && p.status === 'AWAITING_CONFIRMATION' ? (
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="button" disabled={busy} onClick={() => void decide(p, 'confirm')}>
                    Confirm {amount}
                  </button>
                  <button type="button" className="chip" disabled={busy} onClick={() => void decide(p, 'cancel')}>
                    Cancel
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
