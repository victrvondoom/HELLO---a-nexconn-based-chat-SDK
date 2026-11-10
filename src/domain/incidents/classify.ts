import type { IncidentCategory, Urgency } from '../types';

/**
 * Deterministic classification. This is the fallback that keeps essential
 * workflows working when the AI provider is unavailable, and it is also the
 * baseline the AI output is validated against for consistency checks.
 *
 * Rules are ordered: the first category whose keywords match wins, so more
 * specific categories (ACCESSIBILITY, CAPACITY) are checked before general ones.
 */

const CATEGORY_RULES: ReadonlyArray<{ category: IncidentCategory; patterns: RegExp[] }> = [
  {
    category: 'ACCESSIBILITY',
    patterns: [
      /\baccessib/i,
      /\bwheel ?chair/i,
      /\bramp\b/i,
      /\blift\b|\belevator\b/i,
      /\bstep[- ]free\b/i,
      /\bhearing loop\b|\bcaption(s|ing)?\b|\bsign language\b|\bbraille\b/i,
    ],
  },
  {
    category: 'CAPACITY',
    patterns: [
      /\bover ?crowd/i,
      /\btoo many (people|attendees)\b/i,
      /\bcrowded\b/i,
      /\bno (seats|space|room left)\b/i,
      /\bsession\b.{0,30}\bfull\b|\bfull (session|room)\b/i,
      /\bcapacity\b/i,
    ],
  },
  {
    category: 'AV',
    patterns: [
      /\bmic(rophone)?s?\b/i,
      /\baudio\b|\bsound\b/i,
      /\bprojector\b|\bscreen\b|\bdisplay\b/i,
      // "speaker" on its own usually means a person; only equipment phrases count here.
      /\bhdmi\b|\bclicker\b|\bspeaker (system|cabinet|unit)\b|\bloudspeakers?\b/i,
      /\bslides?\b.*\b(not|isn't|won't|don't)\b/i,
      /\bvideo\b/i,
    ],
  },
  {
    category: 'SCHEDULE',
    patterns: [
      /\bschedule\b|\bagenda\b|\btimetable\b/i,
      /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i,
      /\bstart(s|ed)? (late|early)\b|\bdelayed\b|\bmoved\b|\bcancelled session\b/i,
    ],
  },
  {
    category: 'FACILITIES',
    patterns: [
      /\btoilets?\b|\bbathroom\b|\brestrooms?\b/i,
      /\bwi-?fi\b|\binternet\b/i,
      /\btoo (hot|cold)\b|\bair ?con\w*\b|\btemperature\b/i,
      /\bpower\b|\bplug\b|\belectric\w*\b|\bsocket\b/i,
      /\bspill\w*\b|\bbroken\b|\bdirty\b|\bcleaning\b/i,
    ],
  },
  {
    category: 'GENERAL',
    patterns: [],
  },
];

/** Normalises equipment words to canonical names so "mic" and "microphone" match. */
const EQUIPMENT_CANONICAL: ReadonlyArray<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'microphone', pattern: /\bmic(rophone)?s?\b/i },
  { canonical: 'projector', pattern: /\bprojector\b/i },
  { canonical: 'screen', pattern: /\bscreen\b/i },
  { canonical: 'speaker', pattern: /\bspeaker (system|cabinet|unit)\b|\bloudspeakers?\b/i },
  { canonical: 'clicker', pattern: /\bclicker\b/i },
  { canonical: 'hdmi', pattern: /\bhdmi\b/i },
];

const SAFETY_PATTERN = /\b(fire|smoke|injur\w*|medical|emergency|unsafe|evacuat\w*|bleeding|faint\w*)\b/i;
const HIGH_PATTERN =
  /\b(not working|stopped working|doesn't work|does not work|broken|blocked|inaccessible|overcrowded|too many|can'?t (get|enter|access)|no way in)\b/i;
const LOW_PATTERN = /\b(when (you|someone) (have|has) time|no rush|just wondering|question)\b/i;

export interface Classification {
  /** Every distinct concern found. A single message can raise several (e.g. AV and CAPACITY). */
  categories: IncidentCategory[];
  /** The concern to triage first: the first matching rule in priority order. */
  category: IncidentCategory;
  urgency: Urgency;
  equipment: string[];
  /** Which keywords caused the decision. Returned so the UI can explain the classification. */
  matchedSignals: string[];
}

export function classifyUtterance(text: string): Classification {
  const normalised = text.trim();

  const categories: IncidentCategory[] = [];
  const matchedSignals: string[] = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalised))) {
      categories.push(rule.category);
      matchedSignals.push(`category:${rule.category}`);
    }
  }
  const category: IncidentCategory = categories[0] ?? 'GENERAL';
  if (categories.length === 0) {
    categories.push('GENERAL');
  }

  const equipment = EQUIPMENT_CANONICAL.filter((e) => e.pattern.test(normalised)).map((e) => e.canonical);

  let urgency: Urgency = 'MEDIUM';
  if (SAFETY_PATTERN.test(normalised)) {
    urgency = 'CRITICAL';
    matchedSignals.push('urgency:safety');
  } else if (HIGH_PATTERN.test(normalised)) {
    urgency = 'HIGH';
    matchedSignals.push('urgency:disruption');
  } else if (LOW_PATTERN.test(normalised)) {
    urgency = 'LOW';
    matchedSignals.push('urgency:low');
  }

  return { categories, category, urgency, equipment, matchedSignals };
}

/** Lowercase word tokens with stop words removed. Used for description similarity. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'of', 'to', 'and', 'or', 'it',
  'this', 'that', 'there', 'has', 'have', 'been', 'be', 'not', 'too', 'my', 'me', 'i', 'we', 'our',
  'please', 'some', 'with', 'for', 'from', 'stopped', 'working', 'doesnt', "doesn't", 'does',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Finds a room the message refers to. A full room name ("Main Hall", "Room 3")
 * is preferred; a bare number ("room 3") is matched against numbered room names.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveRoomName<T extends { id: string; name: string }>(
  text: string,
  rooms: readonly T[],
): T | null {
  // Whole-word match on the room name, longest name first, so "Room 30" never matches "Room 3".
  const byName = [...rooms]
    .sort((a, b) => b.name.length - a.name.length)
    .find((room) => new RegExp(`(^|[^a-z0-9])${escapeRegex(room.name)}(?![a-z0-9])`, 'i').test(text));
  if (byName) {
    return byName;
  }
  const numbered = /\b(?:room|hall|studio|theatre|theater)\s*([0-9]+)\b/i.exec(text);
  if (numbered?.[1]) {
    const wanted = numbered[1];
    return rooms.find((room) => new RegExp(`(^|[^0-9])${wanted}$`).test(room.name)) ?? null;
  }
  return null;
}
