// Appearances users can give parts: physically based finishes, independent of what the file says.

export interface Appearance {
  label: string;
  group: 'Metal' | 'Plastic & other';
  /** sRGB; without it the part keeps its own colour (e.g. plastics). */
  color?: [number, number, number];
  metalness: number;
  roughness: number;
  /** A clear lacquer layer on top, as on glossy plastic or carbon fibre. */
  clearcoat?: number;
  /** Surface texture (viewer/finishes.ts). */
  finish?: FinishId;
}

export type FinishId = 'brushed' | 'blasted' | 'grain' | 'carbon' | 'wood';

const PRESETS = {
  polishedSteel: { label: 'Polished steel', group: 'Metal', color: [0.8, 0.8, 0.82], metalness: 1, roughness: 0.08 },
  brushedSteel: { label: 'Brushed steel', group: 'Metal', color: [0.72, 0.72, 0.74], metalness: 1, roughness: 0.32, finish: 'brushed' },
  brushedAluminium: { label: 'Brushed aluminium', group: 'Metal', color: [0.86, 0.87, 0.89], metalness: 1, roughness: 0.3, finish: 'brushed' },
  sandBlasted: { label: 'Sand-blasted', group: 'Metal', color: [0.7, 0.7, 0.72], metalness: 1, roughness: 0.6, finish: 'blasted' },
  castIron: { label: 'Cast iron', group: 'Metal', color: [0.33, 0.33, 0.34], metalness: 0.85, roughness: 0.75, finish: 'blasted' },
  brass: { label: 'Brass', group: 'Metal', color: [0.89, 0.73, 0.4], metalness: 1, roughness: 0.22 },
  copper: { label: 'Copper', group: 'Metal', color: [0.95, 0.62, 0.48], metalness: 1, roughness: 0.25 },
  blackAnodised: { label: 'Black anodised', group: 'Metal', color: [0.09, 0.09, 0.1], metalness: 0.8, roughness: 0.4 },
  glossyPlastic: { label: 'Glossy plastic', group: 'Plastic & other', metalness: 0, roughness: 0.25, clearcoat: 1 },
  mattePlastic: { label: 'Matte plastic', group: 'Plastic & other', metalness: 0, roughness: 0.7 },
  texturedPlastic: { label: 'Textured plastic', group: 'Plastic & other', metalness: 0, roughness: 0.85, finish: 'grain' },
  rubber: { label: 'Rubber', group: 'Plastic & other', color: [0.07, 0.07, 0.07], metalness: 0, roughness: 0.95 },
  carbonFibre: { label: 'Carbon fibre', group: 'Plastic & other', color: [0.12, 0.12, 0.13], metalness: 0, roughness: 0.35, clearcoat: 1, finish: 'carbon' },
  wood: { label: 'Wood', group: 'Plastic & other', color: [0.72, 0.53, 0.32], metalness: 0, roughness: 0.6, clearcoat: 0.3, finish: 'wood' },
} satisfies Record<string, Appearance>;

export type AppearanceId = keyof typeof PRESETS;

export const APPEARANCES: Record<AppearanceId, Appearance> = PRESETS;

/** What a node is set to: an appearance, or 'file' to show the file's own look under an ancestor's appearance. */
export type AppearanceSetting = AppearanceId | 'file';
