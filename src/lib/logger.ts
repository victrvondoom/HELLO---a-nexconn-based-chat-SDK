/**
 * Structured logging. One JSON object per line. Never log message text, names or
 * contact details: only event-level identifiers and error classes.
 */
export type LogFields = Record<string, string | number | boolean | null>;

export function log(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === 'error') {
    console.error(line);
  } else {
    console.info(line);
  }
}

export function logError(event: string, fields: LogFields = {}): void {
  log('error', event, fields);
}
