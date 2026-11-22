/**
 * The map of kingdoms: static, by language. Every channel is a door. Only the event's own kingdom is real and
 * enterable; the rest is a fixed sample set, labelled as land waiting for its streamer, so nothing about other
 * events is ever read or shown.
 */
export interface Continent {
  id: string;
  name: string;
  /** Position and size on the 100x60 map. */
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  channels: Array<{ name: string; realm: string; live: boolean; x: number; y: number }>;
}

export const CONTINENTS: readonly Continent[] = [
  { id: 'en', name: 'English', x: 4, y: 6, w: 44, h: 26, colour: '#d9c79a', channels: [
    { name: 'Lanternmere', realm: 'Cozy builders', live: true, x: 14, y: 14 }, { name: 'Emberfall', realm: 'Survival', live: false, x: 30, y: 12 },
    { name: 'Oakhaven', realm: 'Strategy', live: true, x: 24, y: 22 }, { name: 'Pixelport', realm: 'Retro', live: false, x: 38, y: 24 } ] },
  { id: 'de', name: 'Deutsch', x: 54, y: 8, w: 24, h: 20, colour: '#c9b0a0', channels: [
    { name: 'Rabenstein', realm: 'Coding', live: true, x: 62, y: 14 }, { name: 'Moosbach', realm: 'Gemütlich', live: false, x: 70, y: 22 } ] },
  { id: 'es', name: 'Español', x: 8, y: 36, w: 28, h: 18, colour: '#e0b98a', channels: [
    { name: 'Costa Luna', realm: 'Música', live: true, x: 16, y: 44 }, { name: 'Sierra Verde', realm: 'Aventura', live: false, x: 28, y: 46 } ] },
  { id: 'fr', name: 'Français', x: 40, y: 34, w: 22, h: 20, colour: '#d6aab6', channels: [
    { name: 'Petit Port', realm: 'Art', live: false, x: 48, y: 42 }, { name: 'Lumière', realm: 'Cinéma', live: true, x: 56, y: 48 } ] },
  { id: 'many', name: 'Isles of Many Tongues', x: 70, y: 36, w: 26, h: 18, colour: '#b9cfa8', channels: [
    { name: 'Nihon Dock', realm: '日本語', live: false, x: 78, y: 42 }, { name: 'Porto Alto', realm: 'Português', live: true, x: 88, y: 46 } ] },
];
