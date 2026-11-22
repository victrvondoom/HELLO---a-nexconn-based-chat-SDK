// @ts-nocheck -- inherited from Chatdom (see THIRD_PARTY_CHATDOM.md); not type-checked under HELLO's config
/* HELLO: the pure half of terrain-founded-solids.ts, split out so its worker does not import the module that spawns it. A worker that
   imports its own spawner makes Turbopack's production build recurse into the worker chunk forever. */
import { compilePlacedSolids, packCollisionBoxes, type PlacedSolidsInput } from '@chatdom/voxel/collision';

export type FoundedSolidsReply = { readonly boxes: Float64Array } | { readonly error: string };

export function compileFoundedSolidsPacked(input: PlacedSolidsInput): Float64Array {
  return packCollisionBoxes(compilePlacedSolids(input));
}
