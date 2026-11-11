/**
 * Safety sentinel. Runs on every message, before anything else can fail or be rate-limited.
 * It never decides what to do about an emergency; it makes sure the emergency is critical,
 * reaches operations, and that the person sees the venue's emergency guidance first.
 */

export type EmergencyKind = 'MEDICAL' | 'FIRE' | 'SECURITY';

export interface SentinelResult {
  emergency: boolean;
  kind: EmergencyKind | null;
  matched: string[];
}

const PATTERNS: Array<{ kind: EmergencyKind; re: RegExp }> = [
  { kind: 'FIRE', re: /\b(fire|smoke|smoking from|burning smell|flames?|fire alarm|evacuat\w*)\b/gi },
  {
    kind: 'MEDICAL',
    re: /\b(medical|injur\w*|bleeding|faint\w*|collapsed?|unconscious|not breathing|seizure|heart attack|chest pain|allergic reaction|ambulance|first aid)\b/gi,
  },
  { kind: 'SECURITY', re: /\b(weapon|knife|gun|threat\w*|assault\w*|attack\w*|fight\w*|suspicious (package|bag|person)|unattended bag|unsafe|harass\w*)\b/gi },
];

/** Phrases that mention the words without describing an emergency ("fire exit sign", "first aid kit location?"). */
const BENIGN = /\b(fire exit sign|fire safety talk|ceasefire|attack surface|heart of|where is first aid|first aid (desk|kit|station)\b.*\?)/i;

export function detectEmergency(text: string): SentinelResult {
  if (BENIGN.test(text)) return { emergency: false, kind: null, matched: [] };
  for (const { kind, re } of PATTERNS) {
    const matched = [...text.matchAll(re)].map((m) => m[0].toLowerCase());
    if (matched.length > 0) return { emergency: true, kind, matched: [...new Set(matched)] };
  }
  return { emergency: false, kind: null, matched: [] };
}

/**
 * Used only when the event guide has no emergency page. Deliberately generic: it names no number
 * or place that the organisers have not written down.
 */
export const EMERGENCY_FALLBACK: Record<EmergencyKind, string> = {
  MEDICAL: 'If someone is in danger now, call the local emergency number and tell the nearest staff member.',
  FIRE: 'If you see fire or smoke, leave by the nearest marked exit, do not use the lifts, and tell the nearest staff member.',
  SECURITY: 'If you feel unsafe, move away from the area and tell the nearest staff member.',
};

export const EMERGENCY_TERMS: Record<EmergencyKind, string> = {
  MEDICAL: 'emergency first aid medical staff',
  FIRE: 'fire alarm exit lifts assembly emergency',
  SECURITY: 'emergency staff control room',
};
