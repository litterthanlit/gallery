import type { Work } from "@/data/works";
import { createRng } from "@/lib/canvasLayout";

/**
 * The Ring: the works standing on the rim of an invisible crater, each at its
 * own height along a mountainous ridge. World space: +X right, +Y down (heights are negative Y), +Z toward the
 * camera. Angle 0 on the ring faces the camera at yaw 0.
 */

/** One work standing on the ridge. Works repeat only for tiny catalogs. */
export type RingTile = Work & {
  key: string;
  /** Position in ring order (left → right across the front). */
  index: number;
  angle: number;
  /** Ridge height under the tile, 0…1 of the relief amplitude. */
  crest: number;
  /** Resting width (pre-perspective). */
  tileWidth: number;
  /** On-screen width when open. */
  focusWidth: number;
  aspect: number;
  /** Largest on-screen CSS width at rest — for image `sizes`. */
  tileSizePx: number;
  /** On-screen CSS width when open — for image `sizes`. */
  focusSizePx: number;
};

export type RingPose = { yaw: number; pitch: number; dolly: number };

export type RingView = {
  radius: number;
  /** Camera distance; points at depth 0 render at scale 1. */
  perspective: number;
  /** Screen position of the ring's center. */
  cx: number;
  cy: number;
};

export const PITCH_MIN = 0.06;
export const PITCH_MAX = 0.9;
/** Relief amplitude as a share of the ring radius. */
export const RELIEF = 0.3;

const MIN_SLOTS = 16;

export function ringRadius(viewportWidth: number, viewportHeight: number): number {
  // On phones the ring runs past the edges so the front pieces stay legible.
  if (viewportWidth < 640) return Math.min(380, viewportWidth * 0.66);
  return Math.min(620, viewportWidth * 0.36, viewportHeight * 0.66);
}

export function restPitch(viewportWidth: number, viewportHeight: number): number {
  // Portrait screens look down more steeply to use their height.
  return viewportHeight > viewportWidth ? 0.44 : 0.26;
}

export function ringView(viewportWidth: number, viewportHeight: number): RingView {
  const radius = ringRadius(viewportWidth, viewportHeight);
  return {
    radius,
    perspective: radius * 2.6,
    cx: viewportWidth / 2,
    cy: viewportHeight * (viewportHeight > viewportWidth ? 0.45 : 0.56),
  };
}

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
}

/** The ridge's height at `angle`: mountains from a few periodic waves. */
function createRelief(seed: number): (angle: number) => number {
  const rand = createRng(seed);
  const waves = Array.from({ length: 9 }, (_, i) => ({
    // Whole frequencies keep the ring seamless.
    k: 2 + i * 2 + Math.floor(rand() * 2) + (i > 5 ? i * 3 : 0),
    amp: 1 / (1 + i * 0.75),
    phase: rand() * Math.PI * 2,
    // Kept so the seeded sequence (and so the ridge's shape) is unchanged.
    drift: rand(),
  }));
  const norm = waves.reduce((sum, wave) => sum + wave.amp, 0);

  return (angle) => {
    let sum = 0;
    for (const wave of waves) sum += wave.amp * Math.sin(wave.k * angle + wave.phase);
    const peaks = Math.min(1, Math.max(0, 0.5 + (sum / norm) * 1.3));
    return 0.2 + 0.8 * peaks ** 1.4;
  };
}

const relief = createRelief(7);

/** A slow swell that lifts and lowers the ridge. */
export function swell(seconds: number): number {
  return 1 + 0.07 * Math.sin(seconds * 0.7 - 1.26);
}

export function placeOnRing(
  catalog: Work[],
  viewportWidth: number,
  viewportHeight: number,
): RingTile[] {
  if (catalog.length === 0) return [];
  const count = Math.max(
    catalog.length,
    Math.ceil(MIN_SLOTS / catalog.length) * catalog.length,
  );
  const view = ringView(viewportWidth, viewportHeight);
  const compact = viewportWidth < 640;
  const spacing = (Math.PI * 2 * view.radius) / count;
  const box = Math.min(spacing * (compact ? 0.7 : 0.52), view.radius * 0.16);
  const frontScale = view.perspective / (view.perspective - view.radius);
  const maxW = viewportWidth * (compact ? 0.84 : 0.6);
  const maxH = viewportHeight * (compact ? 0.56 : 0.62);

  return Array.from({ length: count }, (_, index) => {
    const work = catalog[index % catalog.length]!;
    const angle = (index / count) * Math.PI * 2;
    const aspect = work.width / work.height;
    const tileWidth = aspect >= 1 ? box : box * aspect;
    const focusWidth = Math.min(maxW, maxH * aspect);
    return {
      ...work,
      key: `${work.id}~${Math.floor(index / catalog.length)}`,
      index,
      angle,
      crest: relief(angle),
      tileWidth,
      focusWidth,
      aspect,
      // Round up to steps so a resize doesn't re-pick images for tiny changes.
      tileSizePx: Math.ceil((tileWidth * frontScale * 1.1) / 16) * 16,
      focusSizePx: Math.ceil(focusWidth / 32) * 32,
    };
  });
}

/** Yaw that brings `angle` to the front. */
export function yawToFront(angle: number): number {
  return -angle;
}

export type Projected = {
  x: number;
  y: number;
  /** Depth after yaw only: negative is the far half of the ring. */
  side: number;
  /** Depth toward the camera after pitch and dolly. */
  depth: number;
  scale: number;
};

/** Project a world point to the screen. Writes into `out` to stay allocation-free. */
export function project(
  x: number,
  y: number,
  z: number,
  pose: RingPose,
  view: RingView,
  out: Projected,
): Projected {
  const cosY = Math.cos(pose.yaw);
  const sinY = Math.sin(pose.yaw);
  const x1 = x * cosY + z * sinY;
  const z1 = z * cosY - x * sinY;
  const cosP = Math.cos(pose.pitch);
  const sinP = Math.sin(pose.pitch);
  const y2 = y * cosP + z1 * sinP;
  const z2 = z1 * cosP - y * sinP + pose.dolly;
  const scale = view.perspective / Math.max(40, view.perspective - z2);
  out.x = view.cx + x1 * scale;
  out.y = view.cy + y2 * scale;
  out.side = z1;
  out.depth = z2;
  out.scale = scale;
  return out;
}

/** The tile nearest the front — the natural target for Enter. */
export function frontTile(tiles: RingTile[], yaw: number): RingTile | null {
  let best: RingTile | null = null;
  let bestFacing = -Infinity;
  for (const tile of tiles) {
    const facing = Math.cos(tile.angle + yaw);
    if (facing > bestFacing) {
      bestFacing = facing;
      best = tile;
    }
  }
  return best;
}
