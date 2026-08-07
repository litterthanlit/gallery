import { works, type Work } from "@/data/works";

export type PlacedWork = Work & {
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DISPLAY_BASE = 380;
const GAP = 128;

export type LayoutOptions = {
  /** Deterministic seed — same seed ⇒ same layout. */
  seed?: number;
  /** Radians added to the spiral start angle. */
  angleOffset?: number;
  /** Multiplier on spiral radius growth. */
  radiusScale?: number;
  /** Extra position jitter amplitude in px. */
  jitter?: number;
  /** Display size multiplier (e.g. 0.92–1.08). */
  sizeScale?: number;
  /** Gap used during overlap push. */
  gap?: number;
};

function displaySize(
  work: Work,
  sizeScale = 1,
): { displayWidth: number; displayHeight: number } {
  const aspect = work.width / work.height;
  if (aspect >= 1) {
    const displayWidth = DISPLAY_BASE * sizeScale;
    return { displayWidth, displayHeight: displayWidth / aspect };
  }
  const displayHeight = DISPLAY_BASE * 1.15 * sizeScale;
  return { displayWidth: displayHeight * aspect, displayHeight };
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

/** Mulberry32 — tiny deterministic PRNG. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Deterministic organic scatter — seeded spiral + overlap push. */
export function layoutWorks(
  items: Work[] = works,
  options: LayoutOptions = {},
): PlacedWork[] {
  const seed = options.seed ?? 1;
  const rand = createRng(seed);
  const angleOffset = options.angleOffset ?? rand() * Math.PI * 2;
  const radiusScale = options.radiusScale ?? 0.9 + rand() * 0.28;
  const jitter = options.jitter ?? 28 + rand() * 55;
  const sizeScale = options.sizeScale ?? 0.94 + rand() * 0.12;
  const gap = options.gap ?? GAP * (0.95 + rand() * 0.25);
  const pushStep = 56 + rand() * 22;

  const placed: PlacedWork[] = [];
  const centerX = (rand() - 0.5) * 40;
  const centerY = (rand() - 0.5) * 40;

  items.forEach((work, index) => {
    const { displayWidth, displayHeight } = displaySize(work, sizeScale);
    const angle = angleOffset + index * 2.399963; // golden angle
    const radius =
      index === 0
        ? rand() * 48
        : (200 + index * (175 + rand() * 45)) * radiusScale;
    let x = centerX + Math.cos(angle) * radius - displayWidth / 2;
    let y = centerY + Math.sin(angle) * radius - displayHeight / 2;

    x += (rand() - 0.5) * jitter * 2;
    y += (rand() - 0.5) * jitter * 2;

    let rect: Rect = { x, y, width: displayWidth, height: displayHeight };
    for (let iter = 0; iter < 48; iter++) {
      let pushed = false;
      for (const other of placed) {
        const otherRect: Rect = {
          x: other.x,
          y: other.y,
          width: other.displayWidth,
          height: other.displayHeight,
        };
        if (!overlaps(rect, otherRect, gap)) continue;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const ox = otherRect.x + otherRect.width / 2;
        const oy = otherRect.y + otherRect.height / 2;
        let dx = cx - ox;
        let dy = cy - oy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        // Nudge off-axis so push paths don't form a rigid lattice.
        const side = (rand() - 0.5) * 0.35;
        rect = {
          ...rect,
          x: rect.x + (dx + -dy * side) * pushStep,
          y: rect.y + (dy + dx * side) * pushStep,
        };
        pushed = true;
      }
      if (!pushed) break;
    }

    placed.push({
      ...work,
      x: rect.x,
      y: rect.y,
      displayWidth,
      displayHeight,
    });
  });

  return placed;
}

export function boundsOf(placed: PlacedWork[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const work of placed) {
    minX = Math.min(minX, work.x);
    minY = Math.min(minY, work.y);
    maxX = Math.max(maxX, work.x + work.displayWidth);
    maxY = Math.max(maxY, work.y + work.displayHeight);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function rectOf(work: PlacedWork): Rect {
  return {
    x: work.x,
    y: work.y,
    width: work.displayWidth,
    height: work.displayHeight,
  };
}

export function centerOf(work: PlacedWork): { x: number; y: number } {
  return {
    x: work.x + work.displayWidth / 2,
    y: work.y + work.displayHeight / 2,
  };
}

export type NavDirection = "left" | "right" | "up" | "down";

/** Nearest piece in a compass direction from `fromId` (half-plane + axis weight). */
export function findNeighbor(
  placed: PlacedWork[],
  fromId: string,
  direction: NavDirection,
): PlacedWork | null {
  const from = placed.find((work) => work.id === fromId);
  if (!from) return null;
  const origin = centerOf(from);

  let best: PlacedWork | null = null;
  let bestScore = Infinity;

  for (const candidate of placed) {
    if (candidate.id === fromId) continue;
    const c = centerOf(candidate);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;

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

    if (along <= 8) continue;
    // Prefer pieces mostly along the swipe axis; penalize large cross-axis offset.
    const score = along + across * 1.35;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

export function directionFromDelta(
  dx: number,
  dy: number,
  minDistance = 48,
): NavDirection | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < minDistance) return null;
  if (absX >= absY) return dx < 0 ? "right" : "left";
  return dy < 0 ? "down" : "up";
}

/**
 * Piece under the zoom point that has grown large enough to magnetically snap.
 * Requires the cursor to sit on the piece (with a modest pad) so empty-space
 * zooms don't yank the camera onto a neighbor.
 */
export function findMagneticWork(
  placed: PlacedWork[],
  worldX: number,
  worldY: number,
  currentScale: number,
  focusScaleFor: (work: PlacedWork) => number,
  snapRatio = 0.88,
  hitPad = 28,
): PlacedWork | null {
  let best: PlacedWork | null = null;
  let bestDist = Infinity;

  for (const work of placed) {
    const focusScale = focusScaleFor(work);
    if (currentScale < focusScale * snapRatio) continue;

    const left = work.x - hitPad;
    const top = work.y - hitPad;
    const right = work.x + work.displayWidth + hitPad;
    const bottom = work.y + work.displayHeight + hitPad;
    if (worldX < left || worldX > right || worldY < top || worldY > bottom) {
      continue;
    }

    const c = centerOf(work);
    const dist = Math.hypot(worldX - c.x, worldY - c.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = work;
    }
  }

  return best;
}
