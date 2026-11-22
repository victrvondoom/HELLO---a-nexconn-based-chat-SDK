'use client';

import { useEffect, useState } from 'react';

/**
 * Twitch redirects here after sign-in (implicit flow: the token is in the URL fragment, which browsers never send to
 * a server). The page removes it from the address bar at once, hands it to HELLO once with the one-time state, and
 * returns to the privacy filter page.
 */
export default function TwitchCallback() {
  const [message, setMessage] = useState('Connecting Twitch…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    window.history.replaceState(null, '', window.location.pathname);
    const token = params.get('access_token');
    const state = params.get('state') ?? query.get('state');
    if (!token || !state) {
      setMessage(query.get('error_description') ?? 'Twitch did not complete the sign-in.');
      return;
    }
    fetch('/api/twitch/finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, token }) })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { ok: true; data: { eventId: string } } | { ok: false; error: { message: string } } | null;
        if (body?.ok) window.location.replace(`/events/${body.data.eventId}/privacy-filter`);
        else setMessage(body ? body.error.message : 'Could not connect Twitch.');
      })
      .catch(() => {
        setMessage('Could not reach HELLO.');
      });
  }, []);

  return (
    <main className="page" style={{ maxWidth: 520, margin: '80px auto' }}>
      <h1>Twitch</h1>
      <p>{message}</p>
    </main>
  );
}
