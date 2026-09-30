/**
 * The Mirror: the catalog as one row. The piece in the middle stands between
 * two mirrors that throw folded, fading copies of its edges outward; its
 * neighbors wait smaller at either side.
 */

export type MirrorMetrics = {
  compact: boolean;
  /** Largest box a centered piece may fill. */
  maxWidth: number;
  maxHeight: number;
  /** Vertical center of the row. */
  centerY: number;
  /** Mirror panel width, as a share of the piece's width. */
  reflection: number;
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
  const reflection = compact ? 0.22 : 0.34;
  const neighborScale = compact ? 0.46 : 0.4;
  const gap = compact ? 10 : 28;
  const firstStep =
    maxWidth / 2 + maxWidth * reflection * 0.8 + gap + (neighborScale * maxWidth) / 2;
  return {
    compact,
    maxWidth,
    maxHeight,
    centerY: height * (compact ? 0.45 : 0.47),
    reflection,
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
  /** 0–1: how much of the mirror shows. Only the middle piece gets it. */
  reflection: number;
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
  const fade = Math.max(0, 1 - a * 1.35);
  return { x, scale, opacity, reflection: fade * fade * (3 - 2 * fade) };
}

/** Fold a distance into [0, span] like light bouncing between two mirrors. */
function fold(distance: number, span: number): number {
  const m = mod(distance, span * 2);
  return m <= span ? m : span * 2 - m;
}

export type Refraction = {
  /** How many piece-widths the panel squeezes in (1 = one plain reflection). */
  depth: number;
  /** Ripple strength, 0 at rest. */
  ripple: number;
  /** Ripple phase, radians. */
  phase: number;
};

/** Canvas rows drawn above and below the piece, so the bend has room to grow. */
export const REFLECTION_BLEED = 0.12;
const STRIP = 2;

/**
 * Paint one mirror panel: `side` 1 sits to the right of the piece, -1 to the
 * left. Column x of the panel (0 at the piece's edge) shows the piece's
 * column at distance s(x) = x + A·(x/R)² from that edge — a true mirror at
 * the seam that squeezes harder outward, folding back and forth across the
 * piece like a kaleidoscope. Strips grow taller outward, as if the mirror
 * leaned away, and ripple while the row is moving.
 */
export function drawReflection(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  side: 1 | -1,
  pieceWidth: number,
  pieceHeight: number,
  panelWidth: number,
  pixelRatio: number,
  refraction: Refraction,
): void {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (panelWidth < 4 || sourceWidth === 0 || sourceHeight === 0) return;

  const bleed = pieceHeight * REFLECTION_BLEED;
  const squeeze = Math.max(0, refraction.depth * pieceWidth - panelWidth);
  const at = (x: number) => x + squeeze * (x / panelWidth) ** 2;
  const fx = sourceWidth / pieceWidth;

  for (let x = 0; x < panelWidth; x += STRIP) {
    const w = Math.min(STRIP, panelWidth - x);
    const t = x / panelWidth;
    const a = fold(at(x), pieceWidth);
    const b = fold(at(x + w), pieceWidth);
    const near = Math.min(a, b);
    const far = Math.max(near + 0.5, Math.max(a, b));
    // Right panel reads leftward from the piece's right edge, and vice versa.
    const sx = side === 1 ? (pieceWidth - far) * fx : near * fx;
    const sw = Math.max(1, (far - near) * fx);
    const grow = 1 + 0.16 * t * t;
    const height = pieceHeight * grow;
    const wave = Math.sin(t * Math.PI * 3 + refraction.phase) * refraction.ripple * t;
    const y = bleed + (pieceHeight - height) / 2 + wave * pieceHeight * 0.05;
    const dx = side === 1 ? x : panelWidth - x - w;
    ctx.drawImage(
      source,
      Math.min(sx, sourceWidth - sw),
      0,
      sw,
      sourceHeight,
      dx * pixelRatio,
      y * pixelRatio,
      w * pixelRatio + 0.6,
      height * pixelRatio,
    );
  }
}
