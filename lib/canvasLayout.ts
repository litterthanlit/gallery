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
