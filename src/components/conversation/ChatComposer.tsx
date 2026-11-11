'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';

const MAX = 2000;

const SUGGESTIONS = [
  'The microphone in Room 3 has stopped working.',
  'There are too many people in Room 3.',
  'The schedule says 2 PM, but the speaker says 2:30 PM.',
  'What is the Wi-Fi password?',
  'I cannot find the accessible entrance.',
  'Can someone help me find a person who works on satellite communication?',
];

/**
 * The single conversational entry point. The server runs the pipeline and stores the answer,
 * so after sending the page is refreshed from the record rather than from local state.
 */
export function ChatComposer({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  async function send() {
    const trimmed = text.trim();
    if (trimmed.length === 0 || pending) {
      if (trimmed.length === 0) setError('Write a message first.');
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
      const body = (await response.json()) as { ok: true } | { ok: false; error: { message: string } };
      if (!body.ok) {
        setError(body.error.message);
        return;
      }
      setText('');
      router.refresh();
      requestAnimationFrame(() => {
        document.getElementById('thread-end')?.scrollIntoView({ behavior: 'smooth' });
      });
    } catch {
      setError('Not sent: the connection failed. Your text is still here, so you can try again.');
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {text.trim().length === 0 ? (
        <div className="chips" aria-label="Suggestions">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              onClick={() => {
                setText(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="message-text" className="visually-hidden">
          Message to HELLO
        </label>
        <textarea
          id="message-text"
          ref={areaRef}
          rows={1}
          value={text}
          maxLength={MAX}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Describe what is happening…"
          aria-describedby="composer-help"
          disabled={pending}
        />
        <button type="submit" className="button" disabled={pending || text.trim().length === 0} aria-label="Send message">
          {pending ? 'Sending' : <Icon name="arrow" />}
        </button>
      </form>

      <div className="composer__foot">
        <span id="composer-help" className="xs faint">
          Enter to send · Shift+Enter for a new line · {text.length}/{MAX}
        </span>
        {error ? (
          <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
