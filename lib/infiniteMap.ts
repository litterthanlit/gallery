import { works, type Work } from "@/data/works";
import {
  boundsOf,
  layoutWorks,
  type PlacedWork,
  type Rect,
} from "@/lib/canvasLayout";

export type MapInstance = PlacedWork & {
  /** Catalog work id without chunk suffix. */
  workId: string;
  chunkX: number;
  chunkY: number;
};

const CHUNK_PAD = 420;

function hash2(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return h | 0;
}

function unit(n: number): number {
  return ((n >>> 0) % 10000) / 10000;
}

/** Home-cell layout used as the repeating tile. */
export function createTileTemplate(items: Work[] = works): {
  template: PlacedWork[];
  chunkSize: number;
  homeBounds: Rect;
} {
  const template = layoutWorks(items);
  const homeBounds = boundsOf(template);
  const span = Math.max(homeBounds.width, homeBounds.height) + CHUNK_PAD * 2;
  return { template, chunkSize: Math.ceil(span), homeBounds };
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

/** Build one chunk's instances from the template, with seeded drift so tiles differ. */
export function instancesForChunk(
  chunkX: number,
  chunkY: number,
  template: PlacedWork[],
  chunkSize: number,
): MapInstance[] {
  const seed = hash2(chunkX, chunkY);
  const driftX = (unit(seed) - 0.5) * 160;
  const driftY = (unit(seed ^ 0x9e3779b9) - 0.5) * 160;
  const originX = chunkX * chunkSize + driftX;
  const originY = chunkY * chunkSize + driftY;

  return template.map((work, index) => {
    const jitterX = (unit(seed + index * 97) - 0.5) * 70;
    const jitterY = (unit(seed + index * 191) - 0.5) * 70;
    return {
      ...work,
      id: makeInstanceId(work.id, chunkX, chunkY),
      workId: work.id,
      chunkX,
      chunkY,
      x: originX + work.x + jitterX,
      y: originY + work.y + jitterY,
    };
  });
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
  template: PlacedWork[],
  chunkSize: number,
): MapInstance[] {
  const view = viewWorldRect(camera, viewportWidth, viewportHeight, 280);
  const chunks = visibleChunks(view, chunkSize, 1);
  const out: MapInstance[] = [];
  for (const { cx, cy } of chunks) {
    out.push(...instancesForChunk(cx, cy, template, chunkSize));
  }
  return out;
}
