'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';

const MAX = 2000;

/** The parts of the Web Speech API used here. It is not in TypeScript's DOM types. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

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
  // Voice input: detected after mount so server and client render the same markup.
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setCanSpeak(speechRecognition() !== null);
    return () => recognitionRef.current?.stop();
  }, []);

  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = document.documentElement.lang || 'en-GB';
    recognition.interimResults = false;
    recognition.continuous = false;
    const before = text.trim();
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results, (result) => result[0]?.transcript ?? '').join(' ').trim();
      if (spoken) setText(`${before}${before ? ' ' : ''}${spoken}`.slice(0, MAX));
    };
    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone access was refused. You can still type.' : 'Voice input stopped. You can still type.');
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }

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
        {canSpeak ? (
          <button
            type="button"
            className="mic-button"
            onClick={toggleVoice}
            aria-pressed={listening}
            aria-label={listening ? 'Stop voice input' : 'Speak your message'}
            title="Speak instead of typing. Your browser's speech service turns it into text, and it may send the audio to its provider."
            disabled={pending}
          >
            <Icon name="mic" />
          </button>
        ) : null}
        <button type="submit" className="button" disabled={pending || text.trim().length === 0} aria-label="Send message">
          {pending ? 'Sending' : <Icon name="arrow" />}
        </button>
      </form>

      <div className="composer__foot">
        <span id="composer-help" className="xs faint">
          <span className="plane-tag plane-tag--open">Read by HELLO and event staff, so they can act</span> Enter to send · {text.length}/{MAX}
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
