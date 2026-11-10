/**
 * Nexconn integration status.
 *
 * HELLO is designed around the Nexconn Chat SDK (`@nexconn/chat`, with `@nexconn/engine`,
 * and the optional `@nexconn/chatui` UI kit). This module does not connect to it. It only reports
 * whether the configuration needed for a connection is present, and it never returns the key itself.
 *
 * States:
 *   NOT_CONFIGURED         — NEXCONN_APP_KEY is missing. Messages are kept by the local demo store only.
 *   CONFIGURED_NOT_CONNECTED — the key is present, but no SDK connection has been made by this build.
 */
export type NexconnState = 'NOT_CONFIGURED' | 'CONFIGURED_NOT_CONNECTED';

export interface NexconnStatus {
  state: NexconnState;
  /** True only when a non-empty app key is configured. The value itself is never exposed. */
  appKeyConfigured: boolean;
  sdkPackage: '@nexconn/chat';
  message: string;
}

export function nexconnStatus(env: Record<string, string | undefined> = process.env): NexconnStatus {
  const appKeyConfigured = (env.NEXCONN_APP_KEY ?? '').trim().length > 0;
  if (!appKeyConfigured) {
    return {
      state: 'NOT_CONFIGURED',
      appKeyConfigured: false,
      sdkPackage: '@nexconn/chat',
      message:
        'Nexconn is not configured. Messages are stored in the local demo store, not sent through Nexconn.',
    };
  }
  return {
    state: 'CONFIGURED_NOT_CONNECTED',
    appKeyConfigured: true,
    sdkPackage: '@nexconn/chat',
    message:
      'A Nexconn app key is configured, but this build does not open an SDK connection yet. Messages are not delivered through Nexconn.',
  };
}
