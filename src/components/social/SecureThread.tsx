'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { deriveConversationKey, open, safetyNumber, seal, type Identity, type PublicJwk } from '@/lib/e2ee/crypto';
import { deviceIdentity, e2eeSupported } from '@/lib/e2ee/keystore';
import { Icon } from '@/components/ui/Icon';

interface Bundle {
  id: string;
  userId: string;
  publicKey: PublicJwk;
  fingerprint: string;
}

interface SealedMsg {
  id: string;
  senderId: string;
  recipientId: string;
  senderKeyId: string;
  recipientKeyId: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

type Shown = { state: 'ok'; text: string } | { state: 'other-device' } | { state: 'unreadable' };

const MAX = 4000;

/**
 * A private conversation. Messages are sealed on this device before they are sent and opened on
 * this device after they arrive. The server relays ciphertext it cannot read; "Show what HELLO
 * stores" displays exactly that ciphertext, so anyone can see the claim is true.
 */
export function SecureThread({ eventId, me, peer }: { eventId: string; me: { id: string; name: string }; peer: { id: string; name: string } }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [peerKeys, setPeerKeys] = useState<Bundle[]>([]);
  const [messages, setMessages] = useState<SealedMsg[]>([]);
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [safety, setSafety] = useState<string | null>(null);
  const keys = useRef(new Map<string, CryptoKey>());
  const endRef = useRef<HTMLDivElement>(null);

  const keyFor = useCallback(
    async (peerBundle: Bundle, id: Identity) => {
      const cached = keys.current.get(peerBundle.id);
      if (cached) return cached;
      const k = await deriveConversationKey(id.keyPair.privateKey, peerBundle.publicKey, { userId: me.id, keyId: id.keyId }, { userId: peer.id, keyId: peerBundle.id });
      keys.current.set(peerBundle.id, k);
      return k;
    },
    [me.id, peer.id],
  );

  const refresh = useCallback(
    async (id: Identity) => {
      const response = await fetch(`/api/events/${eventId}/dm/${peer.id}`, { cache: 'no-store' });
      const body = (await response.json()) as { ok: true; data: { peerKeys: Bundle[]; messages: SealedMsg[] } } | { ok: false; error: { message: string } };
      if (!body.ok) {
        setError(body.error.message);
        return;
      }
      setPeerKeys(body.data.peerKeys);
      setMessages(body.data.messages);
      const next: Record<string, Shown> = {};
      for (const m of body.data.messages) {
        const mine = m.senderId === me.id;
        const myKeyId = mine ? m.senderKeyId : m.recipientKeyId;
        const peerKeyId = mine ? m.recipientKeyId : m.senderKeyId;
        if (myKeyId !== id.keyId) {
          next[m.id] = { state: 'other-device' };
          continue;
        }
        const bundle = body.data.peerKeys.find((k) => k.id === peerKeyId);
        if (!bundle) {
          next[m.id] = { state: 'unreadable' };
          continue;
        }
        try {
          next[m.id] = { state: 'ok', text: await open(await keyFor(bundle, id), m, m.senderId, m.recipientId) };
        } catch {
          next[m.id] = { state: 'unreadable' };
        }
      }
      setShown(next);
    },
    [eventId, peer.id, me.id, keyFor],
  );

  useEffect(() => {
    let cancelled = false;
    if (!e2eeSupported()) {
      setSetupError('Private messages need a secure connection (HTTPS) and a browser that can keep an encryption key.');
      return;
    }
    deviceIdentity(me.id)
      .then(async (id) => {
        if (cancelled) return;
        setIdentity(id);
        await refresh(id);
      })
      .catch(() => {
        if (!cancelled) setSetupError('Could not set up this device for private messages. Reload to try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [me.id, refresh]);

  // Poll while the tab is visible. Each poll fetches ciphertext and opens it locally.
  useEffect(() => {
    if (!identity) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(identity);
    }, 4000);
    return () => {
      clearInterval(timer);
    };
  }, [identity, refresh]);

  const peerKey = peerKeys[peerKeys.length - 1] ?? null;

  useEffect(() => {
    if (identity && peerKey) void safetyNumber(identity.fingerprint, peerKey.fingerprint).then(setSafety);
  }, [identity, peerKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!identity || !peerKey || trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sealed = await seal(await keyFor(peerKey, identity), trimmed, me.id, peer.id);
      const response = await fetch(`/api/events/${eventId}/dm/${peer.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ senderKeyId: identity.keyId, recipientKeyId: peerKey.id, ...sealed }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!body.ok) {
        setError(body.error?.message ?? 'Not sent.');
        return;
      }
      setText('');
      await refresh(identity);
    } catch {
      setError('Not sent: the connection failed. Your text is still here.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const fmt = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }), []);

  return (
    <div className="secure">
      <div className="secure__banner">
        <span className="secure__lock" aria-hidden="true">
          <Icon name="lock" size={16} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>End-to-end encrypted</strong>
          <span className="small muted" style={{ display: 'block' }}>
            Only you and {peer.name} can read these messages. HELLO relays scrambled text it has no key for.
          </span>
        </div>
        <label className="toggle small">
          <input
            type="checkbox"
            checked={raw}
            onChange={(e) => {
              setRaw(e.target.checked);
            }}
          />
          <span>Show what HELLO stores</span>
        </label>
      </div>

      {safety ? (
        <details className="secure__safety">
          <summary>Verify this conversation in person</summary>
          <p className="small muted">
            Compare this number with {peer.name}’s screen. If both match, nobody, including HELLO, has swapped a key between you.
          </p>
          <code className="safety-number">{safety}</code>
        </details>
      ) : null}

      <div className="secure__scroll" role="log" aria-live="polite" aria-label={`Private messages with ${peer.name}`}>
        {setupError ? <p className="notice notice--error">{setupError}</p> : null}
        {!setupError && identity && messages.length === 0 ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <Icon name="lock" size={22} />
            <strong>Say hello to {peer.name}</strong>
            <span>The first message is sealed on this device before it leaves.</span>
          </div>
        ) : null}
        {messages.map((m) => {
          const mine = m.senderId === me.id;
          const s = shown[m.id];
          return (
            <div key={m.id} className={mine ? 'msg msg--me' : 'msg'}>
              <div className="msg__body">
                <span className="msg__meta">
                  {mine ? 'You' : peer.name} · {fmt.format(m.createdAt)} UTC
                </span>
                {raw ? (
                  <div className="bubble bubble--cipher" title="This is everything HELLO's server has for this message.">
                    {m.ciphertext}
                  </div>
                ) : s?.state === 'ok' ? (
                  <div className={mine ? 'bubble bubble--me' : 'bubble'}>{s.text}</div>
                ) : (
                  <div className="bubble bubble--locked">
                    <Icon name="lock" size={13} />{' '}
                    {s?.state === 'other-device' ? 'Sealed to another of your devices. It cannot be opened here.' : 'This message could not be opened on this device.'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="secure__composer">
        {identity && !peerKey ? (
          <p className="notice notice--info small">
            {peer.name} has not opened HELLO on a device yet, so there is no key to seal a message to. You can write as soon as they do.
          </p>
        ) : null}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="dm-text" className="visually-hidden">
            Private message to {peer.name}
          </label>
          <textarea
            id="dm-text"
            rows={1}
            value={text}
            maxLength={MAX}
            onChange={(e) => {
              setText(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder={`Private message to ${peer.name}`}
            disabled={!identity || !peerKey || busy}
          />
          <button type="submit" className="button" disabled={!identity || !peerKey || busy || text.trim().length === 0} aria-label="Send encrypted message">
            <Icon name="arrow" />
          </button>
        </form>
        <div className="composer__foot">
          <span className="xs faint">
            <Icon name="lock" size={11} /> Sealed on this device with AES-256-GCM · {text.length}/{MAX}
          </span>
          {error ? (
            <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>
              {error}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
