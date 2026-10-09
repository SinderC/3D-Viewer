// Surface textures for appearances, drawn on a canvas when first used: no image files, so they work
// offline and under the CSP. Seeded, so a finish looks the same every time.
import * as THREE from 'three';
import type { FinishId } from '../core/appearances';

const SIZE = 512;

/** The geometry attribute finishes are mapped by: box UVs (boxUv.ts), in the last set so a file's own UVs stay usable. */
export const FINISH_UVS = 'uv3';

export interface FinishMaps {
  /** Colour pattern, tinted by the part's colour. */
  map?: THREE.Texture;
  bumpMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  bumpScale: number;
}

// mulberry32
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  return [c, c.getContext('2d')!];
}

// Fills every pixel from f(x, y) → [r, g, b] in 0..255.
function pixels(f: (x: number, y: number) => [number, number, number]): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = f(x, y);
      img.data.set([r, g, b, 255], (y * SIZE + x) * 4);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Fine streaks along u, wrapping at the edges so the tile repeats seamlessly.
function brushed(): HTMLCanvasElement {
  const rnd = random(1);
  const [c, ctx] = canvas();
  ctx.fillStyle = 'rgb(200 200 200)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 6000; i++) {
    const y = rnd() * SIZE;
    const x = rnd() * SIZE;
    const length = 40 + rnd() * 400;
    const v = rnd() < 0.5 ? 150 + rnd() * 40 : 215 + rnd() * 40;
    ctx.fillStyle = `rgb(${v} ${v} ${v} / ${0.15 + rnd() * 0.35})`;
    for (const dx of [0, -SIZE]) ctx.fillRect(x + dx, y, length, 1);
  }
  return c;
}

function noise(seed: number, spread: number): HTMLCanvasElement {
  const rnd = random(seed);
  return pixels(() => {
    const v = 128 + (rnd() - 0.5) * spread;
    return [v, v, v];
  });
}

// Soft blotches, as on spark-eroded (textured) plastic.
function grain(): HTMLCanvasElement {
  const rnd = random(3);
  const [c, ctx] = canvas();
  ctx.fillStyle = 'rgb(128 128 128)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 9000; i++) {
    const [x, y, r] = [rnd() * SIZE, rnd() * SIZE, 1 + rnd() * 3.5];
    const v = rnd() < 0.5 ? 70 : 190;
    ctx.fillStyle = `rgb(${v} ${v} ${v} / 0.35)`;
    for (const [dx, dy] of [[0, 0], [-SIZE, 0], [0, -SIZE], [-SIZE, -SIZE]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  return c;
}

// 2×2 twill: tows alternate direction in a diagonal step pattern, each with fine fibres along it.
function carbon(): HTMLCanvasElement {
  const tows = 8;
  const cell = SIZE / tows;
  const rnd = random(4);
  const fibre = Array.from({ length: SIZE }, () => rnd() * 18);
  return pixels((x, y) => {
    const [i, j] = [Math.floor(x / cell), Math.floor(y / cell)];
    const warp = (((i + j) % 4) + 4) % 4 < 2;
    const along = warp ? (y % cell) / cell : (x % cell) / cell; // across the tow: rounded sheen
    const v = 22 + 46 * Math.sin(Math.PI * along) + fibre[warp ? x : y];
    return [v, v, v + 4];
  });
}

// Straight-grained wood: growth lines along u with uneven spacing and waviness, darker latewood.
// Every term is periodic over the tile so it repeats without a seam.
function wood(): HTMLCanvasElement {
  const rnd = random(5);
  const phase = Array.from({ length: 8 }, () => rnd() * 2 * Math.PI);
  const light = [218, 174, 120];
  const dark = [168, 116, 66];
  const TAU = 2 * Math.PI;
  return pixels((x, y) => {
    const [u, v] = [(TAU * x) / SIZE, (TAU * y) / SIZE];
    const sway = 0.6 + 0.4 * Math.sin(v * 2 + phase[4]); // waviness varies across the board
    const wobble = sway * (0.05 * Math.sin(u + phase[0]) + 0.025 * Math.sin(2 * u + phase[1]) + 0.01 * Math.sin(5 * u + phase[2]));
    // Uneven ring spacing: warp the position across the grain before counting rings.
    const t = v + wobble * TAU + 0.35 * Math.sin(v * 3 + phase[5]) + 0.2 * Math.sin(v * 7 + phase[6]);
    const ring = ((((t / TAU) * 11) % 1) + 1) % 1;
    const late = Math.pow(Math.max(0, Math.sin(Math.PI * ring)), 8);
    const fleck = 0.06 * Math.sin(u * 41 + v * 23 + phase[3]) * Math.sin(u * 13 + phase[7]);
    const k = Math.min(1, Math.max(0, late * 0.75 + fleck + 0.15));
    return [0, 1, 2].map((c) => light[c] + (dark[c] - light[c]) * k) as [number, number, number];
  });
}

// Tile size in mm, and how each drawing is used.
const FINISHES: Record<FinishId, { tileMm: number; draw: () => HTMLCanvasElement; use: (keyof Omit<FinishMaps, 'bumpScale'>)[]; bumpScale: number }> = {
  brushed: { tileMm: 60, draw: brushed, use: ['bumpMap', 'roughnessMap'], bumpScale: 0.6 },
  blasted: { tileMm: 12, draw: () => noise(2, 160), use: ['bumpMap'], bumpScale: 0.5 },
  grain: { tileMm: 25, draw: grain, use: ['bumpMap'], bumpScale: 1.2 },
  carbon: { tileMm: 40, draw: carbon, use: ['map', 'bumpMap'], bumpScale: 0.4 },
  wood: { tileMm: 150, draw: wood, use: ['map'], bumpScale: 0 },
};

/** The textures of each finish, made on first use and shared by all materials. */
export class Finishes {
  private readonly made = new Map<FinishId, FinishMaps>();

  constructor(private readonly anisotropy: number) {}

  get(id: FinishId): FinishMaps {
    let maps = this.made.get(id);
    if (!maps) {
      const f = FINISHES[id];
      const texture = new THREE.CanvasTexture(f.draw());
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.setScalar(1000 / f.tileMm); // box UVs are in metres
      texture.channel = 3; // FINISH_UVS
      texture.anisotropy = this.anisotropy;
      if (f.use.includes('map')) texture.colorSpace = THREE.SRGBColorSpace;
      maps = { bumpScale: f.bumpScale };
      for (const use of f.use) maps[use] = texture;
      this.made.set(id, maps);
    }
    return maps;
  }

  dispose(): void {
    for (const maps of this.made.values()) (maps.map ?? maps.bumpMap ?? maps.roughnessMap)?.dispose();
    this.made.clear();
  }
}
