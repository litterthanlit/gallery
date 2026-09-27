import type { Work } from "@/data/works";

/** Shared geometry and navigation helpers for the gallery views. */

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
