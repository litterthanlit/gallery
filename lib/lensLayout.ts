import type { Work } from "@/data/works";

/**
 * The Lens: an endless square grid of the catalog seen through a fish-eye.
 * Tiles near the lens swell and push their neighbors outward; tiles at the
 * rim are squeezed; everything beyond the rim sits flat and untouched.
 */

export type LensMetrics = {
  /** Distance between tile centers at rest. */
  pitch: number;
  /** Tile edge at rest. */
  tile: number;
  /** Radius of the lens — tiles further out are undistorted. */
  radius: number;
};

/** Magnification at the very center of the lens. Must stay below 4 (see `warpRadius`). */
export const LENS_MAGNIFICATION = 2.4;

export function lensMetrics(width: number, height: number): LensMetrics {
  const compact = width < 640;
  const pitch = compact ? 92 : 128;
  const tile = compact ? 76 : 106;
  const radius = Math.max(pitch * 3.2, Math.min(width, height) * (compact ? 0.5 : 0.6));
  return { pitch, tile, radius };
}

/** Grid cell → work. A stride co-prime with the catalog keeps neighbors apart. */
export function workAt(works: Work[], col: number, row: number): Work {
  const n = works.length;
  const stride = strideFor(n);
  const index = (((col + row * stride) % n) + n) % n;
  return works[index]!;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const strideCache = new Map<number, number>();

function strideFor(n: number): number {
  const cached = strideCache.get(n);
  if (cached) return cached;
  // Roughly n·0.38 so a work's next copy lands well away, diagonals included.
  let stride = Math.max(2, Math.round(n * 0.38));
  while (n > 2 && gcd(stride, n) !== 1) stride += 1;
  strideCache.set(n, stride);
  return stride;
}

/**
 * Radial fish-eye: where a point `distance` from the lens center lands, at
 * lens `power` (0 = flat, 1 = full). The warped radius is
 *
 *   h(d) = d + (M − 1)·d·(1 − u)²,  u = d / R
 *
 * so h(0) = 0, h(R) = R, h'(0) = M and h'(R) = 1: the lens magnifies by M in
 * the middle and blends into the flat grid at its rim with no seam. h stays
 * monotonic (points never pass each other) while M < 4.
 */
export function warpRadius(distance: number, radius: number, power: number): number {
  if (power <= 0 || distance >= radius) return distance;
  const u = distance / radius;
  return distance + (LENS_MAGNIFICATION - 1) * power * distance * (1 - u) * (1 - u);
}

/** Warp a point given relative to the lens center. */
export function warpPoint(dx: number, dy: number, radius: number, power: number): [number, number] {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return [0, 0];
  const reach = warpRadius(distance, radius, power) / distance;
  return [dx * reach, dy * reach];
}

export type WarpedTile = { x: number; y: number; scale: number };

/**
 * A tile centered at (dx, dy) from the lens, `size` across. Its center goes
 * where the warp sends it; its scale comes from where the warp sends its
 * edges. Because the warp never folds, neighbors along a row or column can't
 * overlap — tiles swell in the middle and shrink toward the rim.
 */
export function warpTile(
  dx: number,
  dy: number,
  size: number,
  radius: number,
  power: number,
): WarpedTile {
  const half = size / 2;
  // Wholly outside the lens: untouched.
  if (power <= 0 || Math.hypot(dx, dy) - half * Math.SQRT2 >= radius) {
    return { x: dx, y: dy, scale: 1 };
  }
  const [x, y] = warpPoint(dx, dy, radius, power);
  const left = warpPoint(dx - half, dy, radius, power)[0];
  const right = warpPoint(dx + half, dy, radius, power)[0];
  const top = warpPoint(dx, dy - half, radius, power)[1];
  const bottom = warpPoint(dx, dy + half, radius, power)[1];
  const scaleX = (right - left) / size;
  const scaleY = (bottom - top) / size;
  return { x, y, scale: Math.min(scaleX, scaleY) };
}
