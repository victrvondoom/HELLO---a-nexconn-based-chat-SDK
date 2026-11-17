'use client';

import { useState, type SyntheticEvent } from 'react';
import { ago, api, errorText, useLive } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';

interface TokenRow {
  id: string;
  name: string;
  scope: 'READ' | 'WRITE';
  createdAt: number;
  lastUsedAt: number | null;
}

/** Access tokens for MCP clients. A token is shown once, here, at the moment it is made. */
export function TokenManager({ eventId, now, endpoint }: { eventId: string; now: number; endpoint: string }) {
  const { toast } = useFeedback();
  const { data, refresh } = useLive<{ tokens: TokenRow[] }>('/api/me/tokens', { tokens: [] }, 30_000);
  const [secret, setSecret] = useState<string | null>(null);

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const { token } = await api<{ token: { secret: string } }>('/api/me/tokens', 'POST', { name: values.get('name'), scope: values.get('scope'), eventId });
      setSecret(token.secret);
      form.reset();
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/me/tokens/${id}`, 'DELETE');
      toast('success', 'Token revoked. It stopped working immediately.');
      await refresh();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Connect an AI assistant that speaks the Model Context Protocol. Point it at <code className="code-tag">{endpoint}</code> and give it a token as a Bearer credential. The assistant can do only what you can do, and a read-only token cannot change anything.
      </p>
      {secret ? (
        <div className="notice notice--info" role="status">
          <strong>Copy this token now. It will not be shown again.</strong>
          <code className="secret" style={{ marginTop: 8 }}>{secret}</code>
          <button type="button" className="button button--ghost button--sm" style={{ marginTop: 8 }} onClick={() => { setSecret(null); }}>
            I have copied it
          </button>
        </div>
      ) : null}
      <form className="inline-form" onSubmit={(e) => void create(e)}>
        <label className="field">
          <span className="label">Token name</span>
          <input name="name" required maxLength={60} placeholder="e.g. My desktop assistant" />
        </label>
        <label className="field">
          <span className="label">Access</span>
          <select name="scope" defaultValue="READ">
            <option value="READ">Read only</option>
            <option value="WRITE">Read and write</option>
          </select>
        </label>
        <button type="submit" className="button">
          Create token
        </button>
      </form>
      {data.tokens.length > 0 ? (
        <ul className="score-list" style={{ border: '1px solid var(--hair)', borderRadius: 12 }}>
          {data.tokens.map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.name}</strong>{' '}
                <span className="muted">
                  · {t.scope === 'READ' ? 'read only' : 'read and write'} · {t.lastUsedAt ? `last used ${ago(Math.max(now, t.lastUsedAt), t.lastUsedAt)}` : 'never used'}
                </span>
              </span>
              <button type="button" className="button button--quiet-danger button--sm" onClick={() => void revoke(t.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
