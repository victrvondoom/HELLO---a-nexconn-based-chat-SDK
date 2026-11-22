import type { KingdomChronicleKind } from '../product';

/**
 * Words and limits for things people type into a kingdom. A closed list is deliberate: the kingdom is shown
 * to a whole event, so it errs on the side of refusing. The reason is always given to the person.
 */
export const NAME_MAX = 40;
export const MOTTO_MAX = 120;
export const TITLE_MAX = 30;
export const DECREE_MAX = 280;
export const FORGE_PROMPT_MAX = 120;
/** A citizen may have this many forge requests waiting. */
export const FORGE_PENDING_MAX = 3;
export const MOVE_INTERVAL_MS = 250;
export const HOME_NAME_MAX = 30;

/** Homes grow with followers: a cottage, then a house (5+), then a manor (20+). */
export const HOME_TIERS = [
  { min: 20, storeys: 3, label: 'Manor' },
  { min: 5, storeys: 2, label: 'House' },
  { min: 0, storeys: 1, label: 'Cottage' },
] as const;
export function homeTier(followers: number) {
  return HOME_TIERS.find((t) => followers >= t.min) ?? HOME_TIERS[2];
}

const BLOCKED = ['nazi', 'hitler', 'swastika', 'kkk', 'rape', 'nigg', 'fagg', 'kill yourself', 'suicide', 'porn', 'nude', 'child abuse', 'terror'];
const URL_LIKE = /(https?:\/\/|www\.|\.[a-z]{2,}\/|@[a-z0-9_]{3,})/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

export type TextCheck = { ok: true; text: string } | { ok: false; reason: string };

/** Normalises and screens a short piece of text. Blank, too long, links, hidden direction marks and the list fail. */
export function screenText(input: string, max: number, label: string): TextCheck {
  const text = input.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: `${label} cannot be empty.` };
  if (text.length > max) return { ok: false, reason: `${label} can be at most ${max} characters.` };
  if (CONTROL.test(text)) return { ok: false, reason: `${label} contains characters that cannot be shown.` };
  if (URL_LIKE.test(text)) return { ok: false, reason: `${label} cannot contain links or handles.` };
  const flat = text.toLowerCase().replace(/[^a-z ]/g, '');
  if (BLOCKED.some((w) => flat.includes(w))) return { ok: false, reason: `${label} breaks the kingdom's safety rules.` };
  return { ok: true, text };
}

/**
 * Things that happen outside the world and are told to it. This is the adapter boundary for Twitch-style
 * sources (follow, subscribe, cheer, raid): each is mapped to a world act by the table below, never trusted
 * to say what the act is. Nothing here calls Twitch, and there are no Twitch credentials in this module.
 */
export const INGEST_KINDS = ['FOLLOW', 'SUBSCRIBE', 'CHEER', 'RAID'] as const;
export type IngestKind = (typeof INGEST_KINDS)[number];

export interface WorldAct {
  kind: KingdomChronicleKind;
  text: string;
}

/** A raid arrives as a caravan of at most this many travellers, however big the raid was. */
export const CARAVAN_MAX = 50;

export function actFor(kind: IngestKind, who: string, amount: number): WorldAct {
  const n = Math.max(1, Math.min(Math.floor(amount) || 1, 100_000));
  switch (kind) {
    case 'FOLLOW':
      return { kind: 'CHEER', text: `${who} was seen at the gate and asked to stay.` };
    case 'SUBSCRIBE':
      return { kind: 'CHEER', text: `${who} lit a lantern in the plaza for the realm.` };
    case 'CHEER':
      return { kind: 'CHEER', text: `${who} sent ${n} ${n === 1 ? 'cheer' : 'cheers'}, and fireworks rose over the keep.` };
    case 'RAID': {
      const travellers = Math.min(n, CARAVAN_MAX);
      return { kind: 'CARAVAN', text: `A caravan of ${travellers}${n > CARAVAN_MAX ? ` (of ${n})` : ''} travellers from ${who} arrived at the gate.` };
    }
  }
}
