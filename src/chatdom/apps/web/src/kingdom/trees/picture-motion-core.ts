// @ts-nocheck -- inherited from Chatdom (see THIRD_PARTY_CHATDOM.md); not type-checked under HELLO's config
/* HELLO: the pure half of picture-motion.ts, split out so its worker does not import the module that spawns it. A worker that
   imports its own spawner makes Turbopack's production build recurse into the worker chunk forever. */
import { createPictureTree, TREE_SPECIES, TREE_STYLES, TREE_VARIANTS, type CanopyMotion, type StyleFamily, type TreeSpecies } from '@chatdom/content/trees';
import type { VoxelBlueprint } from '@chatdom/shared';

/**
 * An installed picture tree's wind motion (its canopy and trunk root) comes from growing that tree again, which is
 * slow enough to hold the opening's main thread for every species and variant in town. One worker grows them while
 * the ground is sampled and the meshes are made; the scene reads the same numbers from here.
 */
export interface PictureTreeRef { readonly species: TreeSpecies; readonly style: StyleFamily; readonly variant: number }
export interface PictureMotion { readonly id: string; readonly canopy: CanopyMotion; readonly root: readonly [number, number, number] }
export type PictureMotionReply = { readonly motions: readonly PictureMotion[] } | { readonly error: string };

const PICTURE_TREE = /^tree-(oak|pine|birch|willow|elder)-(hearth|tide|grove)-(\d+)$/;

/** The picture tree an installed flora blueprint is, or undefined. Mirrors the kingdom scene's own test. */
export function pictureTreeOf(blueprint: VoxelBlueprint): PictureTreeRef | undefined {
  const match = PICTURE_TREE.exec(blueprint.id);
  const species = match?.[1] as TreeSpecies | undefined, style = match?.[2] as StyleFamily | undefined, variant = Number(match?.[3]);
  return blueprint.kind === 'flora' && species && style && TREE_SPECIES.includes(species) && TREE_STYLES.includes(style)
    && blueprint.styleId === style && variant < TREE_VARIANTS[species] ? { species, style, variant } : undefined;
}

export function growPictureMotions(refs: readonly PictureTreeRef[]): PictureMotion[] {
  return refs.map(({ species, style, variant }) => { const tree = createPictureTree(species, style, variant); return { id: tree.id, canopy: tree.canopy, root: tree.root }; });
}
