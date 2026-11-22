/**
 * The Forge: turns a short wish into something the world can hold. Deterministic and offline: it matches words
 * to a closed list of kits, so it cannot produce anything that is not on that list. No language model is
 * called, and nothing it makes enters the world until the monarch approves it.
 * Kit names are matched in English, German, Spanish and French.
 */
export const KITS = ['TREE', 'LANTERN', 'FOUNTAIN', 'STATUE', 'BANNER', 'BENCH', 'GARDEN', 'TOWER', 'MARKET', 'CAMPFIRE'] as const;
export type Kit = (typeof KITS)[number];

const WORDS: Record<Kit, readonly string[]> = {
  TREE: ['tree', 'oak', 'forest', 'baum', 'arbol', 'árbol', 'arbre'],
  LANTERN: ['lantern', 'lamp', 'light', 'laterne', 'lampe', 'farol', 'lanterne'],
  FOUNTAIN: ['fountain', 'well', 'water', 'brunnen', 'fuente', 'fontaine'],
  STATUE: ['statue', 'monument', 'hero', 'estatua'],
  BANNER: ['banner', 'flag', 'fahne', 'bandera', 'drapeau'],
  BENCH: ['bench', 'seat', 'bank', 'banco', 'banc'],
  GARDEN: ['garden', 'flower', 'flowers', 'garten', 'blume', 'jardin', 'jardín', 'flor'],
  TOWER: ['tower', 'castle', 'turm', 'torre', 'tour'],
  MARKET: ['market', 'stall', 'shop', 'markt', 'mercado', 'marché'],
  CAMPFIRE: ['fire', 'campfire', 'bonfire', 'feuer', 'fuego', 'feu'],
};

const COLOURS: Record<string, string> = {
  red: '#dc2626', rot: '#dc2626', rojo: '#dc2626', rouge: '#dc2626',
  blue: '#2563eb', blau: '#2563eb', azul: '#2563eb', bleu: '#2563eb',
  green: '#16a34a', grün: '#16a34a', verde: '#16a34a', vert: '#16a34a',
  gold: '#ca8a04', yellow: '#ca8a04', gelb: '#ca8a04', amarillo: '#ca8a04', jaune: '#ca8a04',
  purple: '#9333ea', violet: '#9333ea', lila: '#9333ea', morado: '#9333ea',
  white: '#e5e7eb', weiss: '#e5e7eb', blanco: '#e5e7eb', blanc: '#e5e7eb',
  pink: '#db2777', rosa: '#db2777',
};

export interface ForgeResult {
  kit: Kit;
  colour: string;
}

/** Matches the first kit named in the wish, else null. A wish that names nothing the Forge knows is refused. */
export function forgeFrom(prompt: string): ForgeResult | null {
  const words = prompt.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  let kit: Kit | null = null;
  for (const word of words) {
    kit = KITS.find((k) => WORDS[k].includes(word)) ?? null;
    if (kit) break;
  }
  if (!kit) return null;
  const colour = words.map((w) => COLOURS[w]).find(Boolean) ?? '#a3a3a3';
  return { kit, colour };
}
