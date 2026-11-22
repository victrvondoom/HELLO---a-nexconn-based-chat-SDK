import { describe, expect, it } from 'vitest';
import {
  findMentions,
  findTimeHints,
  parseCsv,
  parseCsvImport,
  parseGeoJsonImport,
  parseImport,
  parseMapLink,
  readPhotoLocation,
  type KnownPlace,
} from '@/domain/places/capture';
import { jpegWithGps, jpegWithoutLocation } from '../helpers/jpeg';

const known: KnownPlace[] = [
  { name: 'Main Hall', source: 'VENUE_SPACE', ref: 'sp-main', spaceId: 'sp-main', latitude: null, longitude: null },
  { name: 'Room 3', source: 'VENUE_SPACE', ref: 'sp-r3', spaceId: 'sp-r3', latitude: null, longitude: null },
  { name: 'Atrium', source: 'VENUE_SPACE', ref: 'sp-atrium', spaceId: 'sp-atrium', latitude: null, longitude: null },
  { name: 'Coffee by the atrium', source: 'SAVED_PLACE', ref: 'plc-1', spaceId: 'sp-atrium', latitude: 51.5, longitude: -0.1 },
];

describe('text mentions', () => {
  it('finds the places a message names, once each, with the words as written', () => {
    const mentions = findMentions("Let's meet at the atrium, then the main hall.", known);
    expect(mentions.map((m) => [m.ref, m.matchedText]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['sp-atrium', 'atrium'],
      ['sp-main', 'main hall'],
    ]);
  });

  it('prefers the longer saved place over the shorter venue name it contains', () => {
    const mentions = findMentions('Coffee by the atrium it is.', known);
    expect(mentions.map((m) => m.ref)).toEqual(['plc-1']);
  });

  it('does not match inside another word or number', () => {
    expect(findMentions('Room 30 is busy', known)).toEqual([]);
    expect(findMentions('Mainland tour', known)).toEqual([]);
  });

  it('returns no mention when nothing known is named', () => {
    expect(findMentions('Let us meet somewhere nice on Saturday', known)).toEqual([]);
  });
});

describe('time hints', () => {
  it('finds dates and times as written, without interpreting them', () => {
    const hints = findTimeHints('Saturday after 5, or tomorrow at 7pm');
    expect(hints).toContain('Saturday after 5');
    expect(hints).toContain('tomorrow');
    expect(hints).toContain('at 7pm');
  });
});

describe('Google Maps and geo links', () => {
  it('reads the name and coordinates from a place link, without fetching it', () => {
    expect(parseMapLink('https://www.google.com/maps/place/Elliot%27s+Beach/@38.7071,-9.1355,15z/data=abc')).toEqual({
      name: "Elliot's Beach",
      latitude: 38.7071,
      longitude: -9.1355,
    });
  });

  it('reads a query link with coordinates, and a geo: link', () => {
    expect(parseMapLink('https://maps.google.com/?q=51.5,-0.12')).toEqual({ name: null, latitude: 51.5, longitude: -0.12 });
    expect(parseMapLink('geo:38.7,-9.13')).toEqual({ name: null, latitude: 38.7, longitude: -9.13 });
  });

  it('refuses other hosts, other schemes and out-of-range coordinates', () => {
    expect(parseMapLink('https://example.com/maps/place/Somewhere/@1,2')).toBeNull();
    expect(parseMapLink('javascript:alert(1)')).toBeNull();
    expect(parseMapLink('https://www.google.com/maps/@95,10,5z')).toBeNull();
    expect(parseMapLink('not a url')).toBeNull();
  });
});

describe('CSV reading', () => {
  it('handles quoted commas, doubled quotes and line breaks inside quotes', () => {
    const rows = parseCsv('Title,Note\r\n"Noodles, the good one","He said ""yes""\nand meant it"\r\n');
    expect(rows).toEqual([
      ['Title', 'Note'],
      ['Noodles, the good one', 'He said "yes"\nand meant it'],
    ]);
  });

  it('reads a Takeout-style saved list and records the rows it cannot read', () => {
    const csv = [
      'Title,Note,URL,Tags,Comment',
      'Noodles,Spicy,"https://www.google.com/maps/place/Noodles/@38.7,-9.1,15z","food;late",',
      ',no title here,,,',
      'Harbour walk,,https://www.google.com/maps/place/Harbour/@38.1,-9.2,15z,,',
    ].join('\n');
    const result = parseCsvImport(csv);
    expect(result.rows.map((row) => row.name)).toEqual(['Noodles', 'Harbour walk']);
    expect(result.rows[0]?.tags).toEqual(['food', 'late']);
    expect(result.rows[0]?.latitude).toBe(38.7);
    expect(result.failures).toEqual([{ line: 3, reason: 'This row has no title.' }]);
  });

  it('refuses a file with no title column rather than guessing', () => {
    const result = parseCsvImport('Place,Where\nNoodles,Lisbon');
    expect(result.rows).toEqual([]);
    expect(result.failures[0]?.reason).toMatch(/Title or Name/);
  });
});

describe('GeoJSON reading (Takeout saved places)', () => {
  it('reads titles, addresses and coordinates, and reports entries without a title', () => {
    const json = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-9.1355, 38.7071] },
          properties: { Title: 'Elliot’s Beach', Location: { Address: 'Lisbon', 'Business Name': 'Elliot' } },
        },
        { type: 'Feature', geometry: null, properties: { Location: {} } },
      ],
    });
    const result = parseGeoJsonImport(json);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: 'Elliot’s Beach', address: 'Lisbon', latitude: 38.7071, longitude: -9.1355 });
    expect(result.failures).toEqual([{ line: 2, reason: 'This place has no title.' }]);
  });

  it('reports malformed JSON and non-collections as a failure, not an exception', () => {
    expect(parseGeoJsonImport('{ nope').failures[0]?.reason).toMatch(/not valid JSON/);
    expect(parseGeoJsonImport('{"type":"Feature"}').failures[0]?.reason).toMatch(/FeatureCollection/);
  });

  it('chooses the reader from the content', () => {
    expect(parseImport('{"features":[]}').format).toBe('GEOJSON');
    expect(parseImport('Title\nNoodles').format).toBe('CSV');
  });
});

describe('photo location (EXIF GPS)', () => {
  it('reads the coordinates a camera recorded, with the sign from the reference letters', () => {
    const photo = jpegWithGps({ latitude: [38, 42, 30], latSign: 'N', longitude: [9, 8, 0], lngSign: 'W' });
    const location = readPhotoLocation(photo);
    expect(location?.latitude).toBeCloseTo(38.708333, 5);
    expect(location?.longitude).toBeCloseTo(-9.133333, 5);
    expect(location?.takenAt).toBeNull();
  });

  it('returns null for a photo with no location, and for bytes that are not a JPEG', () => {
    expect(readPhotoLocation(jpegWithoutLocation())).toBeNull();
    expect(readPhotoLocation(new TextEncoder().encode('just text'))).toBeNull();
    expect(readPhotoLocation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02]))).toBeNull();
  });
});
