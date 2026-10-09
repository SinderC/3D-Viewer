// Appearances users can give parts: physically based finishes, independent of what the file says.

export interface Appearance {
  label: string;
  group: 'Metal' | 'Plastic & other';
  /** sRGB, for finishes defined by their colour (brass); others take the part's colour, or light grey. */
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
  polishedSteel: { label: 'Polished steel', group: 'Metal', metalness: 1, roughness: 0.08 },
  brushedSteel: { label: 'Brushed steel', group: 'Metal', metalness: 1, roughness: 0.32, finish: 'brushed' },
  brushedAluminium: { label: 'Brushed aluminium', group: 'Metal', metalness: 1, roughness: 0.28, finish: 'brushed' },
  sandBlasted: { label: 'Sand-blasted', group: 'Metal', metalness: 1, roughness: 0.6, finish: 'blasted' },
  castIron: { label: 'Cast iron', group: 'Metal', metalness: 0.85, roughness: 0.75, finish: 'blasted' },
  anodised: { label: 'Anodised', group: 'Metal', metalness: 1, roughness: 0.38 },
  // The colour is what makes these two; every other finish takes the part's colour.
  brass: { label: 'Brass', group: 'Metal', color: [0.89, 0.73, 0.4], metalness: 1, roughness: 0.22 },
  copper: { label: 'Copper', group: 'Metal', color: [0.95, 0.62, 0.48], metalness: 1, roughness: 0.25 },
  glossyPlastic: { label: 'Glossy plastic', group: 'Plastic & other', metalness: 0, roughness: 0.25, clearcoat: 1 },
  mattePlastic: { label: 'Matte plastic', group: 'Plastic & other', metalness: 0, roughness: 0.7 },
  texturedPlastic: { label: 'Textured plastic', group: 'Plastic & other', metalness: 0, roughness: 0.85, finish: 'grain' },
  rubber: { label: 'Rubber', group: 'Plastic & other', metalness: 0, roughness: 0.95 },
  carbonFibre: { label: 'Carbon fibre', group: 'Plastic & other', metalness: 0, roughness: 0.35, clearcoat: 1, finish: 'carbon' },
  wood: { label: 'Wood', group: 'Plastic & other', metalness: 0, roughness: 0.6, clearcoat: 0.3, finish: 'wood' },
} satisfies Record<string, Appearance>;

export type AppearanceId = keyof typeof PRESETS;

export const APPEARANCES: Record<AppearanceId, Appearance> = PRESETS;

/** What a node is set to: an appearance, or 'file' to show the file's own look under an ancestor's appearance. */
export type AppearanceSetting = AppearanceId | 'file';

/** A colour users give parts, as #rrggbb (sRGB); finishes take it as the part's colour. */
export type PartColor = `#${string}`;
export type ColorSetting = PartColor | 'file';
