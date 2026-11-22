/**
 * How an upload says whether it went through the privacy filter (written for HELLO).
 *
 * The filter runs on the person's device, so the server cannot inspect a file and know it was protected. What it can
 * do is refuse uploads that did not come through a filtered path: when a person has the filter switched on, every
 * media upload must declare `protected` (it was filtered on the device) or `declined` (the person switched protection
 * off for this one file, in the composer, after being told). Anything else, such as an API script, another client or
 * a future screen that forgot to filter, is refused instead of silently storing an unfiltered file.
 *
 * This guards against accidental bypass inside HELLO. It is not proof against the person themselves: their own
 * device can always send their own file, and that is their choice.
 */

export const UPLOAD_PRIVACY_HEADER = 'x-hello-privacy';
export const UPLOAD_PRIVACY = ['protected', 'declined', 'off'] as const;
export type UploadPrivacy = (typeof UPLOAD_PRIVACY)[number];

export function parseUploadPrivacy(value: string | null): UploadPrivacy | null {
  const v = value?.trim().toLowerCase() ?? '';
  return (UPLOAD_PRIVACY as readonly string[]).includes(v) ? (v as UploadPrivacy) : null;
}

/** null when the upload may proceed, or the reason it is refused. */
export function uploadPrivacyRefusal(filterEnabled: boolean, declared: UploadPrivacy | null): string | null {
  if (!filterEnabled) return null;
  if (declared === 'protected' || declared === 'declined') return null;
  return 'Your privacy filter is on, and this upload did not go through it. Post it from a HELLO composer, which protects it on your device first.';
}
