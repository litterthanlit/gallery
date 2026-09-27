import type { Work } from "@/data/works";
import { createRng, shuffleInPlace, type PlacedWork, type Rect } from "@/lib/canvasLayout";

/**
 * The Field: an endless masonry wall in the spirit of Cosmos. Equal-width
 * columns repeat sideways every TEMPLATE_COLUMNS; each column cycles through
 * the whole catalog in its own shuffled order with a staggered start, so the
 * wall never reads as a tiled pattern and every work is always nearby.
 */

/** World units (1 unit = 1 CSS px at camera scale 1). */
export const COLUMN_WIDTH = 300;
/** Generous gutters — Cosmos is tight; this breathes more. */
export const GUTTER = 72;
const PITCH = COLUMN_WIDTH + GUTTER;
const TEMPLATE_COLUMNS = 7;
const SEED = 0x51f15e;

export type FieldItem = PlacedWork & {
  /** Unique per placement: `${workId}@${column}.${repeat}.${slot}`. */
  id: string;
  workId: string;
};

type ColumnTemplate = {
  works: Work[];
  /** Top of each slot within one period. */
  tops: number[];
  heights: number[];
  period: number;
  offset: number;
};

export type FieldLayout = {
  catalog: Work[];
  columns: ColumnTemplate[];
};

export function createFieldLayout(catalog: Work[]): FieldLayout {
  const rand = createRng(SEED);
  const columns = Array.from({ length: TEMPLATE_COLUMNS }, (_, index) => {
    const order = shuffleInPlace([...catalog], createRng(SEED + index * 7919));
    const tops: number[] = [];
    const heights: number[] = [];
    let y = 0;
    for (const work of order) {
      const height = Math.round((COLUMN_WIDTH * work.height) / work.width);
      tops.push(y);
      heights.push(height);
      y += height + GUTTER;
    }
    return { works: order, tops, heights, period: y, offset: -rand() * y };
  });
  return { catalog, columns };
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

export function workIdOf(itemId: string): string {
  const at = itemId.indexOf("@");
  return at < 0 ? itemId : itemId.slice(0, at);
}

// Items are pure functions of (column, repeat, slot); cache them so React
// sees the same objects frame to frame and can skip re-rendering.
const itemCache = new Map<string, FieldItem>();
const ITEM_CACHE_LIMIT = 4000;

function itemAt(layout: FieldLayout, column: number, repeat: number, slot: number): FieldItem {
  const template = layout.columns[mod(column, layout.columns.length)]!;
  const work = template.works[slot]!;
  const id = `${work.id}@${column}.${repeat}.${slot}`;
  const cached = itemCache.get(id);
  if (cached) return cached;
  const item: FieldItem = {
    ...work,
    id,
    workId: work.id,
    x: column * PITCH,
    y: template.offset + repeat * template.period + template.tops[slot]!,
    displayWidth: COLUMN_WIDTH,
    displayHeight: template.heights[slot]!,
  };
  if (itemCache.size >= ITEM_CACHE_LIMIT) {
    const oldest = itemCache.keys().next().value;
    if (oldest !== undefined) itemCache.delete(oldest);
  }
  itemCache.set(id, item);
  return item;
}

/** Every item overlapping `rect` (world units), top-to-bottom per column. */
export function itemsInRect(layout: FieldLayout, rect: Rect): FieldItem[] {
  const out: FieldItem[] = [];
  const firstColumn = Math.floor(rect.x / PITCH);
  const lastColumn = Math.floor((rect.x + rect.width) / PITCH);
  const bottom = rect.y + rect.height;

  for (let column = firstColumn; column <= lastColumn; column++) {
    if (column * PITCH + COLUMN_WIDTH < rect.x) continue;
    const template = layout.columns[mod(column, layout.columns.length)]!;
    const firstRepeat = Math.floor((rect.y - template.offset) / template.period) - 1;
    const lastRepeat = Math.floor((bottom - template.offset) / template.period);
    for (let repeat = firstRepeat; repeat <= lastRepeat; repeat++) {
      const base = template.offset + repeat * template.period;
      for (let slot = 0; slot < template.works.length; slot++) {
        const top = base + template.tops[slot]!;
        if (top > bottom) break;
        if (top + template.heights[slot]! < rect.y) continue;
        out.push(itemAt(layout, column, repeat, slot));
      }
    }
  }
  return out;
}

/** The placement of `workId` nearest to a world point (every column has one). */
export function nearestPlacement(
  layout: FieldLayout,
  workId: string,
  x: number,
  y: number,
): FieldItem | null {
  const center = Math.floor(x / PITCH);
  let best: FieldItem | null = null;
  let bestDistance = Infinity;
  for (let column = center - 3; column <= center + 3; column++) {
    const template = layout.columns[mod(column, layout.columns.length)]!;
    const slot = template.works.findIndex((work) => work.id === workId);
    if (slot < 0) continue;
    const mid = template.offset + template.tops[slot]! + template.heights[slot]! / 2;
    const repeat = Math.round((y - mid) / template.period);
    const item = itemAt(layout, column, repeat, slot);
    const distance = Math.hypot(
      item.x + item.displayWidth / 2 - x,
      item.y + item.displayHeight / 2 - y,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

/** Overview zoom: ~5 columns on desktop, ~2 on a phone. */
export function overviewScale(viewportWidth: number): number {
  const columns = Math.min(6, Math.max(2.15, viewportWidth / 280));
  return viewportWidth / (columns * PITCH);
}

/**
 * World point the camera starts centered on: the middle of a column when an
 * odd number of columns fits, the middle of a gutter when an even number
 * does, so the wall sits symmetrically instead of showing slivers.
 */
export function homePoint(viewportWidth: number): { x: number; y: number } {
  const across = Math.round(viewportWidth / (PITCH * overviewScale(viewportWidth)));
  const column = Math.floor(TEMPLATE_COLUMNS / 2);
  const x =
    across % 2 === 0
      ? (column + 1) * PITCH - GUTTER / 2
      : column * PITCH + COLUMN_WIDTH / 2;
  return { x, y: 0 };
}
