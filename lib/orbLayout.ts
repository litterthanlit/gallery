import type { Work } from "@/data/works";
import type { NavDirection } from "@/lib/canvasLayout";

/** The orb: a sphere squashed top to bottom, so wider than it is tall. */
export type OrbShape = {
  /** Horizontal (equatorial) radius. */
  rx: number;
  /** Vertical (polar) radius. */
  ry: number;
};

/** One placement of a work on the orb. Works repeat so the orb reads full. */
export type OrbTile = Work & {
  key: string;
  /** Point on the surface. */
  x: number;
  y: number;
  z: number;
  /** CSS `rotateY(lon) rotateX(lat)` turns the tile to lie flat on the surface at (x, y, z). */
  lon: number;
  lat: number;
  /** `lat` for facing straight out from the centre, as an open piece does so it lands face-on. */
  openLat: number;
  /** Surface curvature (1 / radius) along the tile's width and its height. */
  curveX: number;
  curveY: number;
  /** Facet grid that bends the tile to the surface. */
  cols: number;
  rows: number;
  /** Resting size (pre-perspective) on the surface. */
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
/**
 * Free spinning keeps the orb near side-on, where it reads as squashed; seen
 * from a pole it's a full circle. Opening a piece near a pole may tilt
 * further, up to PITCH_LIMIT, to face it.
 */
export const SPIN_PITCH_LIMIT = 0.6;
export const FACING_POINTER_MIN = 0.5;

/** Height over width: below 1, the orb is shorter than it is wide. */
const ORB_SQUASH = 0.68;
/** Aim for roughly this many tiles; rounded up to whole catalog passes. */
const TILE_TARGET = 48;
/** Share of the average tile spacing each tile's longest side takes. */
const TILE_FILL = 0.76;
/**
 * Facets across a tile's short side. Two already land the edges at the
 * surface's depth; each extra facet costs the browser's 3D depth sort roughly
 * quadratically across the whole orb.
 */
const FACETS_SHORT = 2;
const FACETS_MAX = 3;

export function orbShape(viewportWidth: number, viewportHeight: number): OrbShape {
  const rx = Math.min(520, Math.max(140, Math.min(viewportWidth * 0.43, viewportHeight * 0.42)));
  return { rx, ry: rx * ORB_SQUASH };
}

export function focusDolly(radius: number): number {
  return radius * 0.12;
}

/** How far an open piece floats off the surface, clear of its neighbours. */
export function focusRise(radius: number): number {
  return radius * 0.25;
}

/** Perspective magnification at depth `z` (toward camera is positive). */
export function perspectiveScale(z: number, perspective = ORB_PERSPECTIVE): number {
  return perspective / Math.max(40, perspective - z);
}

function facetGrid(aspect: number): { cols: number; rows: number } {
  const long = Math.min(FACETS_MAX, Math.round(FACETS_SHORT * Math.max(aspect, 1 / aspect)));
  return aspect >= 1
    ? { cols: long, rows: FACETS_SHORT }
    : { cols: FACETS_SHORT, rows: long };
}

/** Distance along the tangent after an arc of length `s` with curvature `k`. */
function along(s: number, k: number): number {
  return k > 0 ? Math.sin(s * k) / k : s;
}

/** How far that arc has curved back behind the tangent (zero or negative). */
function below(s: number, k: number): number {
  return k > 0 ? (Math.cos(s * k) - 1) / k : 0;
}

/**
 * Transform that moves the facet centred at (cx, cy) on a flat tile onto a
 * surface touching the tile at its centre and curving by `kx` across it and
 * `ky` down it, then `depth` along the facet's normal.
 */
export function bendFacet(cx: number, cy: number, kx: number, ky: number, depth = 0): string {
  const u = cx * kx;
  const v = cy * ky;
  const back = below(cy, ky);
  const x = along(cx, kx) + back * Math.sin(u) - cx;
  const y = along(cy, ky) - cy;
  const z = below(cx, kx) + back * Math.cos(u);
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateY(${u.toFixed(5)}rad) rotateX(${(-v).toFixed(5)}rad) translateZ(${depth.toFixed(2)}px)`;
}

/** Unit vector a tile turned by CSS `rotateY(lon) rotateX(lat)` faces along. */
export function facingDirection(lon: number, lat: number): { x: number; y: number; z: number } {
  return {
    x: Math.cos(lat) * Math.sin(lon),
    y: -Math.sin(lat),
    z: Math.cos(lat) * Math.cos(lon),
  };
}

function tileCount(catalogSize: number): number {
  if (catalogSize === 0) return 0;
  return Math.max(catalogSize, Math.ceil(TILE_TARGET / catalogSize) * catalogSize);
}

/**
 * Pick which work each slot shows so copies of the same piece land as
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

/** Surface area of the orb from the south pole up to latitude `beta`, as a table to invert. */
function areaTable({ rx, ry }: OrbShape, steps = 512): { beta: number; area: number }[] {
  const table = [{ beta: -Math.PI / 2, area: 0 }];
  // Area of the band at parametric latitude b, per unit of b.
  const band = (b: number) =>
    2 * Math.PI * rx * Math.cos(b) * Math.hypot(rx * Math.sin(b), ry * Math.cos(b));
  for (let step = 1; step <= steps; step += 1) {
    const from = table[step - 1]!;
    const beta = -Math.PI / 2 + (Math.PI * step) / steps;
    table.push({ beta, area: from.area + ((band(from.beta) + band(beta)) / 2) * (beta - from.beta) });
  }
  return table;
}

function latitudeAtArea(table: { beta: number; area: number }[], area: number): number {
  const next = table.findIndex((row) => row.area >= area);
  if (next <= 0) return table[Math.max(0, next)]!.beta;
  const a = table[next - 1]!;
  const b = table[next]!;
  return a.beta + ((area - a.area) / (b.area - a.area)) * (b.beta - a.beta);
}

/**
 * Fibonacci spiral over the orb in CSS 3D space (+X right, +Y down, +Z toward
 * the camera), spaced by equal surface area so the squashed orb stays evenly
 * covered.
 */
export function placeOnOrb(
  catalog: Work[],
  shape: OrbShape,
  viewportWidth: number,
  viewportHeight: number,
): OrbTile[] {
  const count = tileCount(catalog.length);
  if (count === 0) return [];
  const { rx, ry } = shape;

  const table = areaTable(shape);
  const totalArea = table[table.length - 1]!.area;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points = Array.from({ length: count }, (_, index) => {
    // Offset by half a slot keeps tiles off the exact poles.
    const beta = latitudeAtArea(table, totalArea * (1 - (index + 0.5) / count));
    const ring = rx * Math.cos(beta);
    const theta = golden * index;
    return { x: Math.cos(theta) * ring, y: -ry * Math.sin(beta), z: Math.sin(theta) * ring, beta };
  });
  const assigned = assignWorks(
    points.map((point) => ({ x: point.x / rx, y: point.y / rx, z: point.z / rx })),
    catalog,
  );

  const spacing = Math.sqrt(totalArea / count);
  const box = spacing * TILE_FILL;
  const restScale = perspectiveScale(rx) * 1.1;
  const compact = viewportWidth < 640;
  const maxW = viewportWidth * (compact ? 0.84 : 0.6);
  const maxH = viewportHeight * (compact ? 0.56 : 0.62);

  const seen = new Map<string, number>();
  return points.map((point, index) => {
    const work = assigned[index]!;
    const copy = seen.get(work.id) ?? 0;
    seen.set(work.id, copy + 1);
    const aspect = work.width / work.height;
    const tileWidth = aspect >= 1 ? box : box * aspect;
    // Open, the piece sits on the line out through its point, risen and dollied.
    const frontScale = perspectiveScale(
      Math.hypot(point.x, point.y, point.z) + focusRise(rx) + focusDolly(rx),
    );
    const focusWidth = Math.min(maxW, maxH * aspect) / frontScale;
    const ring = Math.hypot(point.x, point.z);
    // Principal curvatures of the squashed sphere: along the meridian (down
    // the tile) and the parallel (across it).
    const stretch = Math.hypot(rx * Math.sin(point.beta), ry * Math.cos(point.beta));
    return {
      ...work,
      key: `${work.id}~${copy}`,
      x: point.x,
      y: point.y,
      z: point.z,
      lon: Math.atan2(point.x, point.z),
      lat: -Math.atan2(point.y / (ry * ry), ring / (rx * rx)),
      openLat: -Math.atan2(point.y, ring),
      curveX: ry / (rx * stretch),
      curveY: (rx * ry) / stretch ** 3,
      ...facetGrid(aspect),
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

export function clampPitch(pitch: number, limit = PITCH_LIMIT): number {
  return Math.min(limit, Math.max(-limit, pitch));
}

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Facing just past the rim, where a piece has flattened and starts to fade. */
const RIM_FACING = 0.42;

/** Facing is 0 (far side) … 1 (toward camera). Opaque until past the rim. */
export function facingOpacity(facing: number): number {
  return 0.08 + 0.92 * smoothstep((facing - 0.15) / (RIM_FACING - 0.15));
}

/** 1 where a piece bends with the surface, easing to 0 (flat) past the rim. */
export function facingBend(facing: number): number {
  return smoothstep((facing - RIM_FACING) / 0.08);
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
