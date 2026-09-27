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

/**
 * Minimum edge-to-edge vertical gap (world units) between two copies of the
 * same work, indexed by how many columns apart they are. Neighbors need the
 * most room so the same piece never sits side by side like a mirror.
 */
const TWIN_GAP = [0, 1100, 600, 250];

/**
 * Columns start from one shared order, each shifted by 2/7 of a period from
 * its neighbor: that spreads every work's copies evenly around the cycle, so
 * the spacing rule holds by construction. Random swaps inside each column are
 * then kept only when no spacing rule breaks and the column doesn't gain
 * "A above B" pairs from the columns beside it, so every column ends up with
 * its own order instead of echoing its neighbors diagonally.
 */
const COLUMN_PHASE = 2 / TEMPLATE_COLUMNS;
const VARIETY_ATTEMPTS = 4000;

function heightOf(work: Work): number {
  return Math.round((COLUMN_WIDTH * work.height) / work.width);
}

function stack(order: Work[], offset: number): ColumnTemplate {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (const work of order) {
    const height = heightOf(work);
    tops.push(y);
    heights.push(height);
    y += height + GUTTER;
  }
  return { works: order, tops, heights, period: y, offset };
}

export function createFieldLayout(catalog: Work[]): FieldLayout {
  // Everything below works on catalog indices and typed arrays: this runs
  // thousands of trials when the Field first opens, so it has to be cheap.
  const n = catalog.length;
  const count = TEMPLATE_COLUMNS;
  const rand = createRng(SEED);
  const height = Float64Array.from(catalog, heightOf);
  const period = height.reduce((sum, h) => sum + h + GUTTER, 0);
  const base = shuffleInPlace(
    Array.from({ length: n }, (_, i) => i),
    createRng(SEED + 7919),
  );
  const start = -rand() * period;
  const offsets = Array.from({ length: count }, (_, t) => start - t * COLUMN_PHASE * period);
  const orders = Array.from({ length: count }, () => [...base]);

  // center[t][work] — each work's center in column t, within one period.
  const centersFor = (order: number[], offset: number, out: Float64Array) => {
    let y = 0;
    for (const work of order) {
      out[work] = mod(offset + y + height[work]! / 2, period);
      y += height[work]! + GUTTER;
    }
    return out;
  };
  const center = orders.map((order, t) => centersFor(order, offsets[t]!, new Float64Array(n)));

  // below[t][a * n + b] = 1 when work b sits directly under work a in column t.
  const belowFor = (order: number[], out: Uint8Array) => {
    out.fill(0);
    for (let i = 0; i < n; i++) out[order[i]! * n + order[(i + 1) % n]!] = 1;
    return out;
  };
  const below = orders.map((order) => belowFor(order, new Uint8Array(n * n)));

  /** Does column t with these centers keep every copy far enough apart? */
  const spaced = (t: number, mine: Float64Array) => {
    for (let k = 1; k < TWIN_GAP.length; k++) {
      const gap = TWIN_GAP[k]!;
      const left = center[mod(t - k, count)]!;
      const right = center[mod(t + k, count)]!;
      for (let work = 0; work < n; work++) {
        for (const other of [left[work]!, right[work]!]) {
          const along = Math.abs(mine[work]! - other);
          if (Math.min(along, period - along) - height[work]! < gap) return false;
        }
      }
    }
    return true;
  };

  /** How many of column t's vertical pairs also appear beside it. */
  const echoes = (t: number, order: number[]) => {
    const left = below[mod(t - 1, count)]!;
    const right = below[mod(t + 1, count)]!;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const pair = order[i]! * n + order[(i + 1) % n]!;
      total += left[pair]! + right[pair]!;
    }
    return total;
  };

  const trialCenters = new Float64Array(n);
  for (let attempt = 0; attempt < VARIETY_ATTEMPTS; attempt++) {
    const t = attempt % count;
    // Mostly near swaps: they disturb fewer positions, so more survive.
    const i = Math.floor(rand() * n);
    const reach = 1 + Math.floor(rand() * (rand() < 0.7 ? 3 : n - 1));
    const j = (i + reach) % n;
    const order = orders[t]!;
    const before = echoes(t, order);
    [order[i], order[j]] = [order[j]!, order[i]!];
    if (spaced(t, centersFor(order, offsets[t]!, trialCenters)) && echoes(t, order) <= before) {
      center[t]!.set(trialCenters);
      belowFor(order, below[t]!);
    } else {
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  }

  const columns = orders.map((order, t) =>
    stack(
      order.map((index) => catalog[index]!),
      offsets[t]!,
    ),
  );
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
