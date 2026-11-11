'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFeedback } from '@/components/ui/Feedback';
import { forgetDeviceIdentity } from '@/lib/e2ee/keystore';

/** Export and erasure. Erasure needs the word ERASE typed, then a second confirmation. */
export function DataRights({ userId }: { userId: string }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  async function erase() {
    const ok = await confirm({
      title: 'Erase your data?',
      body: 'Your profile, follows, device keys and private messages are deleted, and the text of what you told HELLO is redacted. Incident records that staff acted on are kept without your words. This cannot be undone.',
      confirmLabel: 'Erase my data',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch('/api/me/erase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'ERASE' }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!body.ok) {
        toast('error', body.error?.message ?? 'Not erased.');
        return;
      }
      await forgetDeviceIdentity(userId);
      toast('success', 'Your data has been erased.');
      await fetch('/api/demo/session', { method: 'DELETE' });
      router.push('/');
      router.refresh();
    } catch {
      toast('error', 'Could not reach the server. Nothing was erased.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="rights-row">
        <div>
          <strong className="small">Download a copy</strong>
          <p className="xs muted">Everything HELLO holds about you, as JSON. Private messages are included exactly as stored: encrypted.</p>
        </div>
        <a className="button button--ghost button--sm" href="/api/me/export" download>
          Download my data
        </a>
      </div>
      <div className="rights-row rights-row--danger">
        <div style={{ flex: 1 }}>
          <strong className="small">Erase my data</strong>
          <p className="xs muted">Type ERASE to enable the button.</p>
          <label htmlFor="erase-confirm" className="visually-hidden">
            Type ERASE to confirm
          </label>
          <input id="erase-confirm" value={typed} onChange={(e) => { setTyped(e.target.value); }} placeholder="ERASE" style={{ maxWidth: 180, marginTop: 6 }} autoComplete="off" />
        </div>
        <button type="button" className="button button--danger button--sm" disabled={typed !== 'ERASE' || busy} onClick={() => void erase()}>
          {busy ? 'Erasing…' : 'Erase'}
        </button>
      </div>
    </div>
  );
}
