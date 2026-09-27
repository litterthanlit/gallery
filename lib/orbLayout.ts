import type { Work } from "@/data/works";
import type { NavDirection } from "@/lib/canvasLayout";

/** One placement of a work on the sphere. Works repeat so the orb reads full. */
export type OrbTile = Work & {
  key: string;
  x: number;
  y: number;
  z: number;
  /** Resting size (pre-perspective) on the sphere. */
  tileWidth: number;
  /** Size (pre-perspective) that fills the frame when focused. */
  focusWidth: number;
  aspect: number;
  /** Largest on-screen CSS width at rest (front, hovered) — for image `sizes`. */
  tileSizePx: number;
  /** On-screen CSS width when focused — for image `sizes`. */
  focusSizePx: number;
};

export const ORB_PERSPECTIVE = 1500;
export const PITCH_LIMIT = 1.4;
export const FACING_POINTER_MIN = 0.5;

/** Aim for roughly this many tiles; rounded up to whole catalog passes. */
const TILE_TARGET = 48;
/** Share of the average tile spacing each tile's longest side takes. */
const TILE_FILL = 0.82;

export function orbRadius(viewportWidth: number, viewportHeight: number): number {
  return Math.min(420, Math.max(130, Math.min(viewportWidth * 0.4, viewportHeight * 0.34)));
}

export function focusDolly(radius: number): number {
  return radius * 0.12;
}

/** Perspective magnification at depth `z` (toward camera is positive). */
export function perspectiveScale(z: number, perspective = ORB_PERSPECTIVE): number {
  return perspective / Math.max(40, perspective - z);
}

function tileCount(catalogSize: number): number {
  if (catalogSize === 0) return 0;
  return Math.max(catalogSize, Math.ceil(TILE_TARGET / catalogSize) * catalogSize);
}

/**
 * Pick which work each sphere slot shows so copies of the same piece land as
 * far apart as possible. Greedy, deterministic, O(n²) — fine for a few dozen.
 */
function assignWorks(
  points: { x: number; y: number; z: number }[],
  catalog: Work[],
): Work[] {
  const perWork = points.length / catalog.length;
  const used = catalog.map(() => [] as number[]);
  return points.map((point, slot) => {
    let bestIndex = 0;
    let bestScore = -Infinity;
    catalog.forEach((_, workIndex) => {
      const placedSlots = used[workIndex]!;
      if (placedSlots.length >= perWork) return;
      let nearest = 4;
      for (const other of placedSlots) {
        const q = points[other]!;
        nearest = Math.min(
          nearest,
          (point.x - q.x) ** 2 + (point.y - q.y) ** 2 + (point.z - q.z) ** 2,
        );
      }
      // Prefer the farthest-from-its-copies work; break ties toward fewer uses
      // and then catalog order so the layout is stable.
      const score = nearest - placedSlots.length * 0.01 - workIndex * 1e-6;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = workIndex;
      }
    });
    used[bestIndex]!.push(slot);
    return catalog[bestIndex]!;
  });
}

/**
 * Fibonacci sphere in CSS 3D space: +X right, +Y down, +Z toward the camera.
 */
export function placeOnSphere(
  catalog: Work[],
  radius: number,
  viewportWidth: number,
  viewportHeight: number,
): OrbTile[] {
  const count = tileCount(catalog.length);
  if (count === 0) return [];

  const golden = Math.PI * (3 - Math.sqrt(5));
  const unit = Array.from({ length: count }, (_, index) => {
    // Offset variant keeps tiles off the exact poles.
    const yMath = 1 - (2 * index + 1) / count;
    const ring = Math.sqrt(Math.max(0, 1 - yMath * yMath));
    const theta = golden * index;
    return { x: Math.cos(theta) * ring, y: -yMath, z: Math.sin(theta) * ring };
  });
  const assigned = assignWorks(unit, catalog);

  const spacing = radius * Math.sqrt((4 * Math.PI) / count);
  const box = spacing * TILE_FILL;
  const frontScale = perspectiveScale(radius + focusDolly(radius));
  const restScale = perspectiveScale(radius) * 1.1;
  const compact = viewportWidth < 640;
  const maxW = viewportWidth * (compact ? 0.84 : 0.6);
  const maxH = viewportHeight * (compact ? 0.56 : 0.62);

  const seen = new Map<string, number>();
  return unit.map((point, index) => {
    const work = assigned[index]!;
    const copy = seen.get(work.id) ?? 0;
    seen.set(work.id, copy + 1);
    const aspect = work.width / work.height;
    const tileWidth = aspect >= 1 ? box : box * aspect;
    const focusWidth = Math.min(maxW, maxH * aspect) / frontScale;
    return {
      ...work,
      key: `${work.id}~${copy}`,
      x: point.x * radius,
      y: point.y * radius,
      z: point.z * radius,
      tileWidth,
      focusWidth,
      aspect,
      // Round up to steps so a resize doesn't re-pick images for tiny changes.
      tileSizePx: Math.ceil((tileWidth * restScale) / 16) * 16,
      focusSizePx: Math.ceil((focusWidth * frontScale) / 32) * 32,
    };
  });
}

/** Match CSS `rotateX(pitch) rotateY(yaw)` (yaw first, then pitch). */
export function rotatePoint(
  x: number,
  y: number,
  z: number,
  pitch: number,
  yaw: number,
): { x: number; y: number; z: number } {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  return {
    x: x1,
    y: y * cosP - z1 * sinP,
    z: y * sinP + z1 * cosP,
  };
}

export function rotationToFront(
  x: number,
  y: number,
  z: number,
): { pitch: number; yaw: number } {
  return {
    yaw: -Math.atan2(x, z),
    pitch: Math.atan2(y, Math.hypot(x, z)),
  };
}

export function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Facing is 0 (far side) … 1 (toward camera). */
export function facingOpacity(facing: number): number {
  return 0.08 + 0.92 * smoothstep((facing - 0.1) / 0.8);
}

export function facingScale(facing: number): number {
  return 0.7 + 0.3 * Math.max(0, facing);
}

/** Front-most tile — the natural target for Enter in overview. */
export function frontTile(
  tiles: OrbTile[],
  pitch: number,
  yaw: number,
): OrbTile | null {
  let best: OrbTile | null = null;
  let bestZ = -Infinity;
  for (const tile of tiles) {
    const { z } = rotatePoint(tile.x, tile.y, tile.z, pitch, yaw);
    if (z > bestZ) {
      bestZ = z;
      best = tile;
    }
  }
  return best;
}

/**
 * Nearest visible tile in a compass direction using post-rotation X/Y. Skips
 * other copies of the current work so a hop always lands on a new piece.
 */
export function findOrbNeighbor(
  tiles: OrbTile[],
  fromKey: string,
  direction: NavDirection,
  pitch: number,
  yaw: number,
): OrbTile | null {
  const from = tiles.find((tile) => tile.key === fromKey);
  if (!from) return null;
  const origin = rotatePoint(from.x, from.y, from.z, pitch, yaw);

  let best: OrbTile | null = null;
  let bestScore = Infinity;

  for (const candidate of tiles) {
    if (candidate.id === from.id) continue;
    const point = rotatePoint(candidate.x, candidate.y, candidate.z, pitch, yaw);
    if (point.z < 0) continue;
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

    let along = 0;
    let across = 0;
    switch (direction) {
      case "right":
        along = dx;
        across = Math.abs(dy);
        break;
      case "left":
        along = -dx;
        across = Math.abs(dy);
        break;
      case "down":
        along = dy;
        across = Math.abs(dx);
        break;
      case "up":
        along = -dy;
        across = Math.abs(dx);
        break;
    }

    if (along <= 4) continue;
    const score = along + across * 1.35;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
