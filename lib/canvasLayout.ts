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
const GAP = 72;

function displaySize(work: Work): { displayWidth: number; displayHeight: number } {
  const aspect = work.width / work.height;
  if (aspect >= 1) {
    const displayWidth = DISPLAY_BASE;
    return { displayWidth, displayHeight: displayWidth / aspect };
  }
  const displayHeight = DISPLAY_BASE * 1.15;
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

/** Deterministic organic scatter — seeded spiral + overlap push. */
export function layoutWorks(items: Work[] = works): PlacedWork[] {
  const placed: PlacedWork[] = [];
  const centerX = 0;
  const centerY = 0;

  items.forEach((work, index) => {
    const { displayWidth, displayHeight } = displaySize(work);
    const angle = index * 2.399963; // golden angle
    const radius = index === 0 ? 0 : 180 + index * 155;
    let x = centerX + Math.cos(angle) * radius - displayWidth / 2;
    let y = centerY + Math.sin(angle) * radius - displayHeight / 2;

    // Slight deterministic jitter so it feels less spiral-perfect
    x += ((index * 47) % 61) - 30;
    y += ((index * 29) % 53) - 26;

    let rect: Rect = { x, y, width: displayWidth, height: displayHeight };
    for (let iter = 0; iter < 40; iter++) {
      let pushed = false;
      for (const other of placed) {
        const otherRect: Rect = {
          x: other.x,
          y: other.y,
          width: other.displayWidth,
          height: other.displayHeight,
        };
        if (!overlaps(rect, otherRect, GAP)) continue;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const ox = otherRect.x + otherRect.width / 2;
        const oy = otherRect.y + otherRect.height / 2;
        let dx = cx - ox;
        let dy = cy - oy;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        rect = {
          ...rect,
          x: rect.x + dx * 48,
          y: rect.y + dy * 48,
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
 * Piece under/near the zoom point that has grown large enough to magnetically snap.
 * Prefers the piece under the cursor; falls back to the nearest oversized piece
 * whose center is close to the zoom point.
 */
export function findMagneticWork(
  placed: PlacedWork[],
  worldX: number,
  worldY: number,
  currentScale: number,
  focusScaleFor: (work: PlacedWork) => number,
  snapRatio = 0.62,
  hitPad = 48,
): PlacedWork | null {
  let bestHit: PlacedWork | null = null;
  let bestHitDist = Infinity;
  let bestNear: PlacedWork | null = null;
  let bestNearScore = Infinity;

  for (const work of placed) {
    const focusScale = focusScaleFor(work);
    if (currentScale < focusScale * snapRatio) continue;

    const c = centerOf(work);
    const dist = Math.hypot(worldX - c.x, worldY - c.y);
    const halfDiag =
      Math.hypot(work.displayWidth, work.displayHeight) / 2 + hitPad * 2;

    const left = work.x - hitPad;
    const top = work.y - hitPad;
    const right = work.x + work.displayWidth + hitPad;
    const bottom = work.y + work.displayHeight + hitPad;
    const inside =
      worldX >= left && worldX <= right && worldY >= top && worldY <= bottom;

    if (inside && dist < bestHitDist) {
      bestHitDist = dist;
      bestHit = work;
    }

    if (dist < halfDiag) {
      // Closer + more zoomed-in relative to fit wins.
      const score = dist / Math.max(focusScale, 0.001) - currentScale * 40;
      if (score < bestNearScore) {
        bestNearScore = score;
        bestNear = work;
      }
    }
  }

  return bestHit ?? bestNear;
}
