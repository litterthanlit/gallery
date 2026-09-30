/**
 * The Mirror: the catalog as one row inside a mirrored room. The screen's
 * four edges are mirror walls angled away from the viewer; they reflect the
 * piece in the middle, folding it over and over as they recede, and stream
 * while the row slides. The pieces themselves stay clean.
 */

export type MirrorMetrics = {
  compact: boolean;
  /** Largest box a centered piece may fill. */
  maxWidth: number;
  maxHeight: number;
  /** Vertical center of the row. */
  centerY: number;
  /** Depth of the side and top/bottom walls, in pixels from the screen edge. */
  wallX: number;
  wallY: number;
  /** Scale of a piece one step from the middle. */
  neighborScale: number;
  /** Distance from the middle to the first neighbor, then between the rest. */
  firstStep: number;
  step: number;
  /** Pixels of drag per slide. */
  dragPerSlide: number;
};

export function mirrorMetrics(width: number, height: number): MirrorMetrics {
  const compact = width < 640;
  const maxWidth = compact ? width * 0.6 : Math.min(width * 0.38, 620);
  const maxHeight = compact ? height * 0.46 : height * 0.56;
  const neighborScale = compact ? 0.46 : 0.4;
  const gap = compact ? 14 : 48;
  const firstStep = maxWidth / 2 + gap + (neighborScale * maxWidth) / 2;
  return {
    compact,
    maxWidth,
    maxHeight,
    centerY: height * (compact ? 0.45 : 0.47),
    wallX: Math.round(width * (compact ? 0.13 : 0.15)),
    wallY: Math.round(height * (compact ? 0.1 : 0.14)),
    neighborScale,
    firstStep,
    step: neighborScale * maxWidth + gap,
    dragPerSlide: compact ? width * 0.55 : Math.min(420, width * 0.3),
  };
}

/** Fit a work into the centered box, keeping its proportions. */
export function slideSize(
  metrics: MirrorMetrics,
  workWidth: number,
  workHeight: number,
): { width: number; height: number } {
  const scale = Math.min(metrics.maxWidth / workWidth, metrics.maxHeight / workHeight);
  return { width: Math.round(workWidth * scale), height: Math.round(workHeight * scale) };
}

/** Signed distance from slide `index` to `position`, wrapped around the loop. */
export function wrappedOffset(index: number, position: number, count: number): number {
  let offset = (index - position) % count;
  if (offset < -count / 2) offset += count;
  if (offset >= count / 2) offset -= count;
  return offset;
}

export function mod(value: number, count: number): number {
  return ((value % count) + count) % count;
}

export type SlidePose = {
  x: number;
  scale: number;
  opacity: number;
};

export function slidePose(offset: number, metrics: MirrorMetrics): SlidePose {
  const a = Math.abs(offset);
  const sign = Math.sign(offset);
  const near = Math.min(1, a);
  const x = sign * (a <= 1 ? a * metrics.firstStep : metrics.firstStep + (a - 1) * metrics.step);
  const scale =
    a <= 1
      ? 1 + (metrics.neighborScale - 1) * near
      : metrics.neighborScale * Math.max(0.7, 1 - 0.08 * (a - 1));
  const opacity = a <= 1 ? 1 - 0.22 * near : Math.max(0, 0.78 * (1 - (a - 1) / 2));
  return { x, scale, opacity };
}

/** Fold a distance into [0, span] like light bouncing between two mirrors. */
function fold(distance: number, span: number): number {
  const m = mod(distance, span * 2);
  return m <= span ? m : span * 2 - m;
}

export type Refraction = {
  /** How many times each wall folds the piece as it recedes (1 = one plain reflection). */
  depth: number;
  /** Extra fold per side from sliding and the cursor: left/right, top/bottom. */
  lean: number;
  /** Ripple strength, 0 at rest. */
  ripple: number;
  /** Ripple phase, radians. */
  phase: number;
};

/** One piece to reflect; while sliding, two are drawn and crossfade. */
export type WallLayer = {
  source: CanvasImageSource;
  width: number;
  height: number;
  alpha: number;
  /** How far (in slides) this piece is from the middle; streams the walls. */
  offset: number;
};

const STRIP = 3;

/**
 * Screen-space distance from a wall's inner edge (0) out to the screen edge
 * (1) → how far along the reflection that is. Near the inner edge the wall
 * is far away, so the reflection is compressed there, like perspective.
 */
function recede(d: number): number {
  return Math.pow(d, 0.55);
}

/**
 * Paint the four mirror walls. Wall strips are cut so neighbors meet on the
 * diagonals from each screen corner to the inner rectangle, like the seams
 * of a mirrored box. Each strip samples the piece at a folded distance from
 * its matching edge — a true mirror where the wall meets the room, folding
 * back and forth as it approaches the viewer — stretched to the wall's
 * height at that point.
 */
export function drawWalls(
  ctx: CanvasRenderingContext2D,
  layers: WallLayer[],
  width: number,
  height: number,
  wallX: number,
  wallY: number,
  pixelRatio: number,
  refraction: Refraction,
): void {
  const { canvas } = ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const { ripple, phase } = refraction;

  for (const layer of layers) {
    const { source, width: sw, height: sh } = layer;
    if (layer.alpha <= 0.004 || sw === 0 || sh === 0) continue;
    ctx.globalAlpha = layer.alpha;

    // Left (-1) and right (1) walls: vertical strips.
    for (const side of [-1, 1] as const) {
      const depth = Math.max(0.6, refraction.depth + side * refraction.lean);
      const stream = -layer.offset * sw * 0.9 * side;
      for (let i = 0; i < wallX; i += STRIP) {
        const w = Math.min(STRIP, wallX - i);
        // i counts inward from the screen edge.
        const outer = 1 - i / wallX;
        const inner = 1 - (i + w) / wallX;
        const a = fold(recede(inner) * depth * sw + stream, sw);
        const b = fold(recede(outer) * depth * sw + stream, sw);
        const near = Math.min(a, b);
        const span = Math.max(1, Math.abs(b - a));
        // Mirror: the left wall shows the piece's left edge first, and so on.
        const sx = side === -1 ? near : sw - near - span;
        const t = i / wallX;
        const top = t * wallY;
        const h = height - top * 2;
        const wave = Math.sin(t * 9 + phase) * ripple * (1 - t) * height * 0.018;
        const x = side === -1 ? i : width - i - w;
        ctx.drawImage(
          source,
          Math.max(0, Math.min(sx, sw - span)),
          0,
          span,
          sh,
          x,
          top + wave,
          w + 0.5,
          h,
        );
      }
    }

    // Top (-1) and bottom (1) walls: horizontal strips.
    for (const side of [-1, 1] as const) {
      const depth = Math.max(0.6, refraction.depth * 0.8 + side * refraction.lean * 0.4);
      const stream = -layer.offset * sh * 0.35;
      for (let i = 0; i < wallY; i += STRIP) {
        const h = Math.min(STRIP, wallY - i);
        const outer = 1 - i / wallY;
        const inner = 1 - (i + h) / wallY;
        const a = fold(recede(inner) * depth * sh + stream, sh);
        const b = fold(recede(outer) * depth * sh + stream, sh);
        const near = Math.min(a, b);
        const span = Math.max(1, Math.abs(b - a));
        const sy = side === -1 ? near : sh - near - span;
        const t = i / wallY;
        const left = t * wallX;
        const w = width - left * 2;
        const wave = Math.sin(t * 9 + phase * 1.3) * ripple * (1 - t) * width * 0.012;
        const y = side === -1 ? i : height - i - h;
        ctx.drawImage(
          source,
          0,
          Math.max(0, Math.min(sy, sh - span)),
          sw,
          span,
          left + wave,
          y,
          w,
          h + 0.5,
        );
      }
    }
  }

  // Each wall is strongest at the screen edge and melts into the room.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  // [gradient from inner edge → screen edge, then the wall's four corners].
  const walls: [number, number, number, number, [number, number][]][] = [
    [wallX, 0, 0, 0, [[0, 0], [wallX, wallY], [wallX, height - wallY], [0, height]]],
    [width - wallX, 0, width, 0, [[width, 0], [width - wallX, wallY], [width - wallX, height - wallY], [width, height]]],
    [0, wallY, 0, 0, [[0, 0], [width, 0], [width - wallX, wallY], [wallX, wallY]]],
    [0, height - wallY, 0, height, [[0, height], [width, height], [width - wallX, height - wallY], [wallX, height - wallY]]],
  ];
  for (const [x0, y0, x1, y1, corners] of walls) {
    // Fade inside this wall only, so neighbors meet cleanly on the diagonals.
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, "rgb(0 0 0 / 1)");
    gradient.addColorStop(0.3, "rgb(0 0 0 / 0.45)");
    gradient.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // Hairline seams where walls meet, catching the light.
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgb(255 255 255 / 0.55)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(wallX, wallY);
  ctx.moveTo(width, 0);
  ctx.lineTo(width - wallX, wallY);
  ctx.moveTo(0, height);
  ctx.lineTo(wallX, height - wallY);
  ctx.moveTo(width, height);
  ctx.lineTo(width - wallX, height - wallY);
  ctx.stroke();
}
