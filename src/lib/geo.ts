import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import atlas from 'world-atlas/countries-110m.json';

/**
 * The world map is drawn from Natural Earth country outlines shipped with the app (world-atlas).
 * No map tiles are fetched, so opening the map tells no third party where anyone is.
 */
export const MAP_SIZE = { width: 960, height: 480 } as const;

const topology = atlas as unknown as Topology;
const countriesObject = topology.objects.countries;
if (!countriesObject) throw new Error('world-atlas is missing its countries layer.');
const collection = feature(topology, countriesObject) as unknown as FeatureCollection<Geometry, { name: string }>;
const projection = geoNaturalEarth1().fitSize([MAP_SIZE.width, MAP_SIZE.height], { type: 'Sphere' });
const path = geoPath(projection);

export interface CountryShape {
  code: string;
  name: string;
  d: string;
}

/** Outlines rounded to one decimal: about a third of the size, with no visible difference at this scale. */
export const COUNTRY_SHAPES: readonly CountryShape[] = collection.features
  .filter((f) => typeof f.id === 'string' || typeof f.id === 'number')
  .map((f) => ({ code: String(f.id).padStart(3, '0'), name: f.properties.name, d: (path(f) ?? '').replace(/\d+\.\d+/g, (n) => Number(n).toFixed(1)) }))
  .filter((c) => c.d.length > 0);

export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = COUNTRY_SHAPES.map(({ code, name }) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));

const NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name]));

export function isCountry(code: string): boolean {
  return NAMES.has(code);
}

export function countryName(code: string | null): string | null {
  return code ? (NAMES.get(code) ?? null) : null;
}

/** Map coordinates for a position, or null when the projection cannot place it. */
export function project(lat: number, lng: number): { x: number; y: number } | null {
  const point = projection([lng, lat]);
  return point ? { x: Math.round(point[0] * 10) / 10, y: Math.round(point[1] * 10) / 10 } : null;
}
