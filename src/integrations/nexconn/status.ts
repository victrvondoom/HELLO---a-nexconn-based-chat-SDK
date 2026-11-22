/**
 * Nexconn integration status.
 *
 * HELLO uses three Nexconn packages, all installed and sharing one engine:
 *   @nexconn/chat    Chat SDK: messages, channels, presence
 *   @nexconn/chatui  Chat UI: ready-made chat screens (web components)
 *   @nexconn/call    Call SDK: optional voice and video (peer pinned to 26.2.0, overridden to the
 *                    installed chat/engine in package.json "overrides"; re-test when Nexconn ships 26.5)
 *
 * The App Key identifies the app and may reach the browser. The App Secret signs server API calls and must
 * never leave the server: this module reports only whether each is present, never a value.
 *
 * States:
 *   NOT_CONFIGURED        no NEXCONN_APP_KEY. HELLO works on its own; the chat gateway connects networks.
 *   KEY_ONLY              App Key present, App Secret missing: the server cannot issue user tokens.
 *   READY_FOR_TOKENS      App Key and App Secret present. Token issuance still needs the verified server
 *                         API call in src/integrations/nexconn/token.ts (see docs/nexconn-integration.md).
 */
export type NexconnState = 'NOT_CONFIGURED' | 'KEY_ONLY' | 'READY_FOR_TOKENS';

export const NEXCONN_PACKAGES = ['@nexconn/chat', '@nexconn/chatui', '@nexconn/call'] as const;

export interface NexconnStatus {
  state: NexconnState;
  /** True only when a non-empty app key is configured. The value itself is never exposed. */
  appKeyConfigured: boolean;
  appSecretConfigured: boolean;
  sdkPackage: '@nexconn/chat';
  packages: readonly string[];
  message: string;
}

const present = (value: string | undefined) => (value ?? '').trim().length > 0;

export function nexconnStatus(env: Record<string, string | undefined> = process.env): NexconnStatus {
  const appKeyConfigured = present(env.NEXCONN_APP_KEY);
  const appSecretConfigured = present(env.NEXCONN_APP_SECRET);
  const base = { appKeyConfigured, appSecretConfigured, sdkPackage: '@nexconn/chat' as const, packages: NEXCONN_PACKAGES };
  if (!appKeyConfigured) {
    return {
      ...base,
      state: 'NOT_CONFIGURED',
      message: 'Nexconn is not configured. HELLO works in the app; connect Nexconn through the chat gateway (docs/nexconn-integration.md).',
    };
  }
  if (!appSecretConfigured) {
    return {
      ...base,
      state: 'KEY_ONLY',
      message: 'A Nexconn App Key is configured, but no App Secret, so the server cannot issue user tokens yet.',
    };
  }
  return {
    ...base,
    state: 'READY_FOR_TOKENS',
    message: 'Nexconn App Key and App Secret are configured on the server. Browsers receive only the App Key and a server-issued token.',
  };
}
