/**
 * Place capture: turning text, links, imported files and photo metadata into place candidates.
 *
 * Pure: no storage, no network, no clock. Nothing here saves a place; the service saves only what the person
 * chooses from the candidates they reviewed. Every parser is defensive: a malformed row becomes a recorded failure,
 * never an exception that reaches the page.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export type CandidateSource = 'VENUE_SPACE' | 'VENUE_POI' | 'SAVED_PLACE';

/** A place the system already knows about, that text can refer to. */
export interface KnownPlace {
  name: string;
  source: CandidateSource;
  /** Space or POI id, or the saved place id. */
  ref: string;
  spaceId: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CaptureFailure {
  line: number;
  reason: string;
}

// ---------- text mentions ----------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PlaceMention {
  name: string;
  source: CandidateSource;
  ref: string;
  spaceId: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The exact words that matched, as written in the text. */
  matchedText: string;
}

/**
 * Finds known places that the text names. Longer names win over shorter ones that they contain, and a place is
 * reported once. Matching is case-insensitive and respects word boundaries, so "Room 3" does not match "Room 30".
 */
export function findMentions(text: string, known: readonly KnownPlace[]): PlaceMention[] {
  const haystack = text.replace(/[’‘]/g, "'");
  const sorted = [...known].filter((place) => place.name.trim().length >= 3).sort((a, b) => b.name.length - a.name.length);
  const found = new Map<string, PlaceMention>();
  const claimed: Array<[number, number]> = [];
  for (const place of sorted) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(place.name.replace(/[’‘]/g, "'"))})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    for (const match of haystack.matchAll(pattern)) {
      const start = match.index + (match[1]?.length ?? 0);
      const end = start + (match[2]?.length ?? 0);
      if (claimed.some(([from, to]) => start < to && end > from)) continue;
      claimed.push([start, end]);
      if (!found.has(place.ref)) {
        found.set(place.ref, {
          name: place.name,
          source: place.source,
          ref: place.ref,
          spaceId: place.spaceId,
          latitude: place.latitude,
          longitude: place.longitude,
          matchedText: haystack.slice(start, end),
        });
      }
    }
  }
  return [...found.values()];
}

const WEEKDAY = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)';
const TIME_HINT = /\b(?:(?:after|before|at|by|from)\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bafter\s+\d{1,2}\b|\b(?:tonight|tomorrow|today|this weekend|next week)\b/gi;

/** Date and time phrases in the text, returned as written. They are hints for the person, never saved as facts. */
export function findTimeHints(text: string): string[] {
  const hints = new Set<string>();
  for (const match of text.matchAll(new RegExp(`\\b${WEEKDAY}\\b(?:\\s+(?:after|before|at|by)\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)?`, 'gi'))) {
    hints.add(match[0].trim());
  }
  for (const match of text.matchAll(TIME_HINT)) hints.add(match[0].trim());
  return [...hints];
}

// ---------- links ----------

export interface LinkPlace {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).trim();
  } catch {
    return value.replace(/\+/g, ' ').trim();
  }
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/**
 * Reads a place from a Google Maps link, or a geo: link. Nothing is fetched: the name and coordinates come from the
 * link itself. Returns null for anything that is not a recognised place link.
 */
export function parseMapLink(raw: string): LinkPlace | null {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('geo:')) {
    const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(trimmed);
    if (!match) return null;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    return validCoordinates(latitude, longitude) ? { name: null, latitude, longitude } : null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!(host === 'maps.google.com' || host.endsWith('.google.com') || host === 'goo.gl' || host === 'maps.app.goo.gl')) return null;

  const placeMatch = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  const name = placeMatch?.[1] ? decodePart(placeMatch[1]) : null;
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname + url.search);
  const q = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
  const qCoords = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(q.trim());
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (at) {
    latitude = Number(at[1]);
    longitude = Number(at[2]);
  } else if (qCoords) {
    latitude = Number(qCoords[1]);
    longitude = Number(qCoords[2]);
  }
  if (latitude !== null && longitude !== null && !validCoordinates(latitude, longitude)) return null;
  const finalName = name ?? (q && !qCoords ? decodePart(q) : null);
  if (!finalName && latitude === null) return null;
  return { name: finalName && finalName.length > 0 ? finalName : null, latitude, longitude };
}

// ---------- CSV ----------

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
  return rows;
}

export interface ImportRow {
  line: number;
  name: string;
  note: string | null;
  url: string | null;
  tags: string[];
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ParsedImport {
  format: 'CSV' | 'GEOJSON';
  rows: ImportRow[];
  failures: CaptureFailure[];
}

function columnIndex(header: readonly string[], names: readonly string[]): number {
  const lowered = header.map((cell) => cell.trim().toLowerCase());
  for (const name of names) {
    const index = lowered.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

/** Google Takeout saved-list CSV: Title, Note, URL, Tags, Comment. Other column layouts are reported, not guessed. */
export function parseCsvImport(text: string): ParsedImport {
  const rows = parseCsv(text);
  const failures: CaptureFailure[] = [];
  const out: ImportRow[] = [];
  const header = rows[0] ?? [];
  const titleColumn = columnIndex(header, ['title', 'name']);
  if (titleColumn < 0) {
    return { format: 'CSV', rows: [], failures: [{ line: 1, reason: 'The first row needs a Title or Name column.' }] };
  }
  const noteColumn = columnIndex(header, ['note', 'comment']);
  const urlColumn = columnIndex(header, ['url', 'link']);
  const tagsColumn = columnIndex(header, ['tags']);
  const addressColumn = columnIndex(header, ['address']);
  const latColumn = columnIndex(header, ['latitude', 'lat']);
  const lngColumn = columnIndex(header, ['longitude', 'lng', 'lon']);
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index] ?? [];
    const line = index + 1;
    if (out.length + failures.length >= MAX_IMPORT_ROWS) {
      failures.push({ line, reason: `Only ${MAX_IMPORT_ROWS} rows are read at once. Split the file.` });
      break;
    }
    const name = (cells[titleColumn] ?? '').trim();
    if (name.length === 0) {
      failures.push({ line, reason: 'This row has no title.' });
      continue;
    }
    const url = urlColumn >= 0 ? (cells[urlColumn] ?? '').trim() : '';
    const fromUrl = url ? parseMapLink(url) : null;
    const latitude = latColumn >= 0 ? Number((cells[latColumn] ?? '').trim()) : (fromUrl?.latitude ?? null);
    const longitude = lngColumn >= 0 ? Number((cells[lngColumn] ?? '').trim()) : (fromUrl?.longitude ?? null);
    const valid = latitude !== null && longitude !== null && validCoordinates(latitude, longitude);
    out.push({
      line,
      name,
      note: noteColumn >= 0 ? (cells[noteColumn] ?? '').trim() || null : null,
      url: url || null,
      tags: tagsColumn >= 0 ? (cells[tagsColumn] ?? '').split(/[,;]/).map((tag) => tag.trim()).filter((tag) => tag.length > 0) : [],
      address: addressColumn >= 0 ? (cells[addressColumn] ?? '').trim() || null : null,
      latitude: valid ? latitude : null,
      longitude: valid ? longitude : null,
    });
  }
  return { format: 'CSV', rows: out, failures };
}

// ---------- GeoJSON (Google Takeout saved places) ----------

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Takeout saved places: a FeatureCollection whose properties hold Title and Location. */
export function parseGeoJsonImport(text: string): ParsedImport {
  const failures: CaptureFailure[] = [];
  const out: ImportRow[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { format: 'GEOJSON', rows: [], failures: [{ line: 1, reason: 'The file is not valid JSON.' }] };
  }
  if (!isObject(data) || !Array.isArray(data.features)) {
    return { format: 'GEOJSON', rows: [], failures: [{ line: 1, reason: 'Expected a GeoJSON FeatureCollection with features.' }] };
  }
  data.features.forEach((feature, index) => {
    const line = index + 1;
    if (out.length + failures.length >= MAX_IMPORT_ROWS) {
      failures.push({ line, reason: `Only ${MAX_IMPORT_ROWS} places are read at once. Split the file.` });
      return;
    }
    if (!isObject(feature)) {
      failures.push({ line, reason: 'This entry is not a place.' });
      return;
    }
    const properties = isObject(feature.properties) ? feature.properties : {};
    const location = isObject(properties.Location) ? properties.Location : {};
    const name = [properties.Title, properties.title, properties.name, location['Business Name']].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );
    if (!name) {
      failures.push({ line, reason: 'This place has no title.' });
      return;
    }
    let latitude: number | null = null;
    let longitude: number | null = null;
    const geo = isObject(location['Geo Coordinates']) ? location['Geo Coordinates'] : null;
    if (geo && typeof geo.Latitude === 'string' && typeof geo.Longitude === 'string') {
      latitude = Number(geo.Latitude);
      longitude = Number(geo.Longitude);
    } else if (isObject(feature.geometry) && Array.isArray(feature.geometry.coordinates)) {
      const [lng, lat] = feature.geometry.coordinates as unknown[];
      if (typeof lng === 'number' && typeof lat === 'number') {
        latitude = lat;
        longitude = lng;
      }
    }
    const valid = latitude !== null && longitude !== null && validCoordinates(latitude, longitude);
    const address = typeof location.Address === 'string' && location.Address.trim().length > 0 ? location.Address.trim() : null;
    const url = typeof properties['Google Maps URL'] === 'string' ? properties['Google Maps URL'] : null;
    out.push({
      line,
      name: name.trim(),
      note: typeof properties.Note === 'string' && properties.Note.trim().length > 0 ? properties.Note.trim() : null,
      url,
      tags: [],
      address,
      latitude: valid ? latitude : null,
      longitude: valid ? longitude : null,
    });
  });
  return { format: 'GEOJSON', rows: out, failures };
}

/** Picks the reader from the content: JSON is GeoJSON, anything else is treated as CSV. */
export function parseImport(text: string): ParsedImport {
  return text.trimStart().startsWith('{') ? parseGeoJsonImport(text) : parseCsvImport(text);
}

// ---------- photo metadata (EXIF GPS) ----------

export interface PhotoPlace {
  latitude: number;
  longitude: number;
  takenAt: string | null;
}

/**
 * Reads GPS coordinates and the capture date from a JPEG's EXIF block. Only metadata is read; the image is never
 * decoded or stored. Returns null when there is no GPS data or the file is not a readable JPEG.
 */
/**
 * The JPEG's EXIF block alone, wrapped as a JPEG with no picture (SOI, the APP1 "Exif" segment, EOI), or a bare
 * SOI + EOI when it has none. The browser sends this instead of the photo, so reading a photo's location never
 * sends its pixels anywhere (the privacy filter's rule: pictures leave the device only after they were protected).
 */
export function jpegMetadataOnly(bytes: Uint8Array): Uint8Array {
  const empty = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return empty;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) return empty;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const segment = offset + 4;
    if (marker === 0xe1 && bytes.length > segment + 6 && String.fromCharCode(...bytes.slice(segment, segment + 6)) === 'Exif\0\0') {
      const end = Math.min(bytes.length, offset + 2 + length);
      const out = new Uint8Array(2 + (end - offset) + 2);
      out.set([0xff, 0xd8]);
      out.set(bytes.subarray(offset, end), 2);
      out.set([0xff, 0xd9], out.length - 2);
      return out;
    }
    offset += 2 + length;
  }
  return empty;
}

export function readPhotoLocation(bytes: Uint8Array): PhotoPlace | null {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1] ?? 0;
      if (marker === 0xda || marker === 0xd9) return null;
      const length = view.getUint16(offset + 2, false);
      const segment = offset + 4;
      if (marker === 0xe1 && bytes.length > segment + 6 && String.fromCharCode(...bytes.slice(segment, segment + 6)) === 'Exif\0\0') {
        return readExifSegment(bytes, view, segment + 6);
      }
      offset += 2 + length;
    }
    return null;
  } catch {
    return null;
  }
}

function readExifSegment(bytes: Uint8Array, view: DataView, tiff: number): PhotoPlace | null {
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return null;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(tiff + 2) !== 0x2a) return null;

  const readEntries = (ifd: number): Map<number, { type: number; count: number; valueAt: number }> => {
    const entries = new Map<number, { type: number; count: number; valueAt: number }>();
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 } as Record<number, number>)[type] ?? 1;
      const valueAt = size * n > 4 ? tiff + u32(entry + 8) : entry + 8;
      entries.set(u16(entry), { type, count: n, valueAt });
    }
    return entries;
  };
  const rational = (at: number): number => {
    const numerator = u32(at);
    const denominator = u32(at + 4);
    return denominator === 0 ? 0 : numerator / denominator;
  };
  const dms = (at: number): number => rational(at) + rational(at + 8) / 60 + rational(at + 16) / 3600;

  const ifd0 = readEntries(tiff + u32(tiff + 4));
  const gpsPointer = ifd0.get(0x8825);
  const exifPointer = ifd0.get(0x8769);
  if (!gpsPointer) return null;
  const gps = readEntries(tiff + u32(gpsPointer.valueAt));
  const latRef = gps.get(1);
  const lat = gps.get(2);
  const lngRef = gps.get(3);
  const lng = gps.get(4);
  if (!latRef || !lat || !lngRef || !lng) return null;
  const latSign = String.fromCharCode(bytes[latRef.valueAt] ?? 0) === 'S' ? -1 : 1;
  const lngSign = String.fromCharCode(bytes[lngRef.valueAt] ?? 0) === 'W' ? -1 : 1;
  const latitude = latSign * dms(lat.valueAt);
  const longitude = lngSign * dms(lng.valueAt);
  if (!validCoordinates(latitude, longitude)) return null;

  let takenAt: string | null = null;
  if (exifPointer) {
    const exif = readEntries(tiff + u32(exifPointer.valueAt));
    const original = exif.get(0x9003);
    if (original) {
      const text = String.fromCharCode(...bytes.slice(original.valueAt, original.valueAt + 19));
      const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
      if (match) takenAt = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
    }
  }
  return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6, takenAt };
}
