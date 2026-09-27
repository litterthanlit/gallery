import type { Rect } from "@/lib/canvasLayout";

export type Camera = {
  x: number;
  y: number;
  scale: number;
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 3.2;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Zoom keeping the world point under (sx, sy) screen coords fixed. */
export function zoomAt(
  camera: Camera,
  screenX: number,
  screenY: number,
  nextScale: number,
): Camera {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const worldX = (screenX - camera.x) / camera.scale;
  const worldY = (screenY - camera.y) / camera.scale;
  return {
    scale,
    x: screenX - worldX * scale,
    y: screenY - worldY * scale,
  };
}

/** Camera that fits `rect` inside the viewport with padding. */
export function fitRect(
  rect: Rect,
  viewportWidth: number,
  viewportHeight: number,
  padding = 64,
  scaleFactor = 1,
): Camera {
  const availW = Math.max(1, viewportWidth - padding * 2);
  const availH = Math.max(1, viewportHeight - padding * 2);
  const scale = clamp(
    Math.min(availW / rect.width, availH / rect.height) * scaleFactor,
    MIN_SCALE,
    MAX_SCALE,
  );
  const x = viewportWidth / 2 - (rect.x + rect.width / 2) * scale;
  const y = viewportHeight / 2 - (rect.y + rect.height / 2) * scale;
  return { x, y, scale };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
