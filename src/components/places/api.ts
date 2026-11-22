/** Shared request helpers for the My places components. Every call goes to a route that checks ownership on the server. */

export type Outcome<T = unknown> = { ok: true; data: T } | { ok: false; message: string };

export async function postJson<T = unknown>(url: string, body: unknown): Promise<Outcome<T>> {
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await response.json()) as { ok: true; data: T } | { ok: false; error: { message: string } };
    return json.ok ? { ok: true, data: json.data } : { ok: false, message: json.error.message };
  } catch {
    return { ok: false, message: 'The request did not reach HELLO. Check your connection and try again.' };
  }
}

export async function postForm<T = unknown>(url: string, form: FormData): Promise<Outcome<T>> {
  try {
    const response = await fetch(url, { method: 'POST', body: form });
    const json = (await response.json()) as { ok: true; data: T } | { ok: false; error: { message: string } };
    return json.ok ? { ok: true, data: json.data } : { ok: false, message: json.error.message };
  } catch {
    return { ok: false, message: 'The photo did not reach HELLO. Check your connection and try again.' };
  }
}

/** A timestamp as the UTC time people read on the page, e.g. "2026-11-22 14:05 UTC". */
export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** A timestamp in the form a datetime-local input uses, shown in UTC so it matches the page. */
export function toUtcInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function fromUtcInput(value: string): number {
  return new Date(`${value}:00.000Z`).getTime();
}
