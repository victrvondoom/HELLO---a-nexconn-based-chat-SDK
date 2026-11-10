'use client';

import { useRouter } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';
import type { MessageResponse } from '@/services/pipeline';

const MAX = 2000;

/**
 * The single conversational entry point. It submits the message to the server, which runs the
 * pipeline, and renders what HELLO did: incidents created or matched, alternatives, approvals,
 * and any question it needs answered. Nothing here decides an outcome.
 */
export function Composer({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MessageResponse | null>(null);

  async function send(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError('Write a message first.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = (await response.json()) as { ok: true; data: MessageResponse } | { ok: false; error: { message: string } };
      if (!body.ok) {
        setError(body.error.message);
        return;
      }
      setResult(body.data);
      setText('');
      router.refresh();
    } catch {
      setError('Your message was not sent because the connection failed. Your text is still here, so you can try again.');
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <section className="panel stack" aria-labelledby="composer-heading">
      <h2 id="composer-heading">Tell HELLO what is happening</h2>
      <form className="stack" onSubmit={(e) => void send(e)}>
        <div className="field">
          <label htmlFor="message-text">Message</label>
          <textarea
            id="message-text"
            value={text}
            maxLength={MAX}
            onChange={(e) => { setText(e.target.value); }}
            onKeyDown={onKeyDown}
            placeholder="For example: The microphone in Room 3 has stopped working."
            aria-describedby="composer-help"
          />
          <span id="composer-help" className="small muted">
            Enter sends. Shift+Enter starts a new line. {text.length}/{MAX}
          </span>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="button button--ghost" onClick={() => { setText('The schedule says 2 PM, but the speaker says 2:30 PM.'); }}>
            Try an example
          </button>
          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Sending…' : 'Send'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
      </form>

      {result ? <ResponseSummary eventId={eventId} result={result} /> : null}
    </section>
  );
}

function ResponseSummary({ eventId, result }: { eventId: string; result: MessageResponse }) {
  return (
    <div className="stack" aria-live="polite">
      <div className="notice notice--info">
        <div className="small muted">
          Understood as <strong>{result.interpretation.intent.replace(/_/g, ' ').toLowerCase()}</strong>
          {result.interpretation.category ? ` · ${result.interpretation.category}` : ''} · urgency{' '}
          {result.interpretation.urgency.toLowerCase()} · source{' '}
          {result.interpretation.source === 'AI_PROVIDER' ? 'AI provider' : 'deterministic rules (no AI provider configured)'}
        </div>
        <p style={{ margin: '6px 0 0' }}>{result.reply}</p>
      </div>

      {result.clarifyingQuestion ? (
        <p className="notice" role="status">
          {result.clarifyingQuestion}
        </p>
      ) : null}

      {result.incidents.map((i) => (
        <div key={i.reportId} className="panel small">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{i.title}</strong>
            <span className={i.attached ? 'badge badge--accent' : 'badge'}>{i.attached ? 'Matched existing' : 'New incident'}</span>
          </div>
          <div className="muted">
            {i.category} · urgency {i.urgency.toLowerCase()} · status {i.status.replace(/_/g, ' ').toLowerCase()}
          </div>
          {i.attached && i.matchConfidence !== null ? (
            <div className="muted">
              Match confidence {i.matchConfidence.toFixed(2)}: {i.matchSignals.join(', ')}
            </div>
          ) : null}
          <a href={`/events/${eventId}/incidents/${i.incidentId}`}>Open incident</a>
        </div>
      ))}

      {result.alternatives && result.alternatives.recommendations.length > 0 ? (
        <div className="panel stack small">
          <h3>Alternative sessions</h3>
          {result.alternatives.recommendations.map((r) => (
            <div key={r.sessionId}>
              <strong>{r.title}</strong> · {r.roomName} · score {r.total.toFixed(2)}
              <ul className="muted" style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {r.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {result.people.length > 0 ? (
        <div className="panel stack small">
          <h3>People who declared a matching interest</h3>
          {result.people.map((p) => (
            <div key={p.userId}>
              <strong>{p.displayName}</strong> · {p.reason}
            </div>
          ))}
        </div>
      ) : null}

      {result.statusReport ? (
        <div className="panel small">
          <strong>{result.statusReport.title}</strong>: {result.statusReport.statusLabel}.{' '}
          {result.statusReport.assigneeName ? `Assigned to ${result.statusReport.assigneeName}.` : 'Not yet claimed.'}
        </div>
      ) : null}

      {result.approval ? (
        <div className="notice small">
          Approval request {result.approval.id} is pending with an organiser ({result.approval.level.replace('_', ' ')}).
          Nothing has changed until it is approved and executed.
        </div>
      ) : null}
    </div>
  );
}
