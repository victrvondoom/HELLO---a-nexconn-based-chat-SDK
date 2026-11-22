'use client';

import { useState } from 'react';
import { connectNexconn, type NexconnConnection } from '@/integrations/nexconn/client';

/**
 * Connects this browser to Nexconn with a token HELLO's server issued for you, and says what happened.
 * Nothing is sent or stored: it only proves the chain App Key → server token → SDK connection works.
 */
export function NexconnCheck() {
  const [state, setState] = useState<'idle' | 'busy' | NexconnConnection>('idle');
  async function run() {
    setState('busy');
    try {
      setState(await connectNexconn());
    } catch (e) {
      setState({ connected: false, reason: 'ERROR', message: e instanceof Error ? e.message : 'The connection failed.' });
    }
  }
  return (
    <span className="stack" style={{ gap: 6 }}>
      <button type="button" className="button button--sm button--ghost" style={{ alignSelf: 'flex-start' }} disabled={state === 'busy'} onClick={() => { void run(); }}>
        {state === 'busy' ? 'Connecting…' : 'Test the Nexconn connection'}
      </button>
      {typeof state === 'object' ? (
        <span role="status" data-testid="nexconn-check" className={state.connected ? 'badge badge--success' : 'small'} style={{ alignSelf: 'flex-start' }}>
          {state.connected ? `Connected to Nexconn as ${state.nexconnUserId.slice(0, 9)}…` : `Not connected: ${state.message}`}
        </span>
      ) : null}
    </span>
  );
}
