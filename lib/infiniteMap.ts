import { works, type Work } from "@/data/works";
import {
  boundsOf,
  createRng,
  layoutWorks,
  shuffleInPlace,
  type PlacedWork,
  type Rect,
} from "@/lib/canvasLayout";

export type MapInstance = PlacedWork & {
  /** Catalog work id without chunk suffix. */
  workId: string;
  chunkX: number;
  chunkY: number;
};

const CHUNK_PAD = 560;

function hash2(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return h | 0;
}

/** Home-cell layout used for initial camera fit + chunk sizing. */
export function createTileTemplate(items: Work[] = works): {
  template: PlacedWork[];
  chunkSize: number;
  homeBounds: Rect;
  catalog: Work[];
} {
  const template = layoutWorks(items, {
    seed: 1,
    angleOffset: 0,
    radiusScale: 1.05,
    jitter: 36,
    sizeScale: 1,
    gap: 128,
  });
  const refBounds = boundsOf(template);
  const chunkSize = Math.ceil(
    Math.max(refBounds.width, refBounds.height) + CHUNK_PAD * 2,
  );
  const home = instancesForChunk(0, 0, items, chunkSize);
  return {
    template,
    chunkSize,
    homeBounds: boundsOf(home),
    catalog: items,
  };
}

export function makeInstanceId(
  workId: string,
  chunkX: number,
  chunkY: number,
): string {
  return `${workId}::${chunkX}:${chunkY}`;
}

export function parseInstanceId(
  id: string,
): { workId: string; chunkX: number; chunkY: number } | null {
  const at = id.lastIndexOf("::");
  if (at < 0) return null;
  const workId = id.slice(0, at);
  const rest = id.slice(at + 2);
  const [sx, sy] = rest.split(":");
  const chunkX = Number(sx);
  const chunkY = Number(sy);
  if (!workId || !Number.isFinite(chunkX) || !Number.isFinite(chunkY)) {
    return null;
  }
  return { workId, chunkX, chunkY };
}

export function catalogIndex(workId: string, items: Work[] = works): number {
  return items.findIndex((work) => work.id === workId);
}

/**
 * Pick a varied subset + order for this chunk so neighboring tiles
 * don't echo the same manufactured collage.
 */
function catalogForChunk(catalog: Work[], seed: number): Work[] {
  const rand = createRng(seed ^ 0xa24baed5);
  const pool = shuffleInPlace([...catalog], rand);

  // Most chunks show nearly everything; occasionally drop 1–3 so density breathes.
  const drop =
    pool.length <= 4 ? 0 : Math.min(3, Math.floor(rand() * rand() * 4));
  const kept = drop > 0 ? pool.slice(0, pool.length - drop) : pool;

  // Rotate starting piece so the "center" work isn't always Chaos.
  const rot = Math.floor(rand() * kept.length);
  return kept.slice(rot).concat(kept.slice(0, rot));
}

/** Build one chunk with a unique seeded arrangement. */
export function instancesForChunk(
  chunkX: number,
  chunkY: number,
  catalog: Work[],
  chunkSize: number,
): MapInstance[] {
  const seed = hash2(chunkX, chunkY);
  const rand = createRng(seed);

  const subset = catalogForChunk(catalog, seed);
  const local = layoutWorks(subset, {
    seed: seed ^ 0x27d4eb2d,
    angleOffset: rand() * Math.PI * 2,
    radiusScale: 0.95 + rand() * 0.35,
    jitter: 40 + rand() * 60,
    sizeScale: 0.9 + rand() * 0.18,
    gap: 110 + rand() * 50,
  });

  const localBounds = boundsOf(local);
  // Center the cluster in the chunk cell, then add a little cell drift.
  const driftX = (rand() - 0.5) * chunkSize * 0.12;
  const driftY = (rand() - 0.5) * chunkSize * 0.12;
  const originX =
    chunkX * chunkSize +
    (chunkSize - localBounds.width) / 2 -
    localBounds.x +
    driftX;
  const originY =
    chunkY * chunkSize +
    (chunkSize - localBounds.height) / 2 -
    localBounds.y +
    driftY;

  return local.map((work) => ({
    ...work,
    id: makeInstanceId(work.id, chunkX, chunkY),
    workId: work.id,
    chunkX,
    chunkY,
    x: originX + work.x,
    y: originY + work.y,
  }));
}

export function visibleChunks(
  view: Rect,
  chunkSize: number,
  marginChunks = 1,
): Array<{ cx: number; cy: number }> {
  const minCX = Math.floor(view.x / chunkSize) - marginChunks;
  const maxCX = Math.floor((view.x + view.width) / chunkSize) + marginChunks;
  const minCY = Math.floor(view.y / chunkSize) - marginChunks;
  const maxCY = Math.floor((view.y + view.height) / chunkSize) + marginChunks;
  const chunks: Array<{ cx: number; cy: number }> = [];
  for (let cy = minCY; cy <= maxCY; cy++) {
    for (let cx = minCX; cx <= maxCX; cx++) {
      chunks.push({ cx, cy });
    }
  }
  return chunks;
}

/** World rect currently visible through the camera. */
export function viewWorldRect(
  camera: { x: number; y: number; scale: number },
  viewportWidth: number,
  viewportHeight: number,
  pad = 200,
): Rect {
  const scale = Math.max(camera.scale, 0.001);
  return {
    x: -camera.x / scale - pad,
    y: -camera.y / scale - pad,
    width: viewportWidth / scale + pad * 2,
    height: viewportHeight / scale + pad * 2,
  };
}

export function gatherVisibleInstances(
  camera: { x: number; y: number; scale: number },
  viewportWidth: number,
  viewportHeight: number,
  catalog: Work[],
  chunkSize: number,
): MapInstance[] {
  const view = viewWorldRect(camera, viewportWidth, viewportHeight, 280);
  const chunks = visibleChunks(view, chunkSize, 1);
  const out: MapInstance[] = [];
  for (const { cx, cy } of chunks) {
    out.push(...instancesForChunk(cx, cy, catalog, chunkSize));
  }
  return out;
}
