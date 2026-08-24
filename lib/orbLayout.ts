import { works, type Work } from "@/data/works";
import type { NavDirection } from "@/lib/canvasLayout";

export type OrbWork = Work & {
  x: number;
  y: number;
  z: number;
  displayWidth: number;
  displayHeight: number;
};

export const ORB_PERSPECTIVE = 1800;
export const ORB_ORIGIN_Y = 0.45;
export const PITCH_LIMIT = 1.15;
export const FACING_POINTER_MIN = 0.45;

const RADIUS_RATIO = 0.36;
const PIECE_RATIO = 0.38;

export function orbRadius(viewportMin: number): number {
  return Math.max(140, viewportMin * RADIUS_RATIO);
}

function displaySize(
  work: Work,
  radius: number,
): { displayWidth: number; displayHeight: number } {
  const base = radius * PIECE_RATIO;
  const aspect = work.width / work.height;
  if (aspect >= 1) {
    return { displayWidth: base, displayHeight: base / aspect };
  }
  const displayHeight = base * 1.15;
  return { displayWidth: displayHeight * aspect, displayHeight };
}

/**
 * Fibonacci sphere in CSS 3D space: +X right, +Y down, +Z toward the camera.
 */
export function placeOnSphere(
  items: Work[] = works,
  radius: number,
): OrbWork[] {
  const n = items.length;
  if (n === 0) return [];

  const golden = Math.PI * (3 - Math.sqrt(5));

  return items.map((work, index) => {
    const yMath = n === 1 ? 0 : 1 - (index / (n - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - yMath * yMath));
    const theta = golden * index;
    const { displayWidth, displayHeight } = displaySize(work, radius);
    return {
      ...work,
      x: Math.cos(theta) * ring * radius,
      y: -yMath * radius,
      z: Math.sin(theta) * ring * radius,
      displayWidth,
      displayHeight,
    };
  });
}

/** Match CSS `rotateX(pitch) rotateY(yaw)` (yaw first, then pitch). */
export function rotatePoint(
  x: number,
  y: number,
  z: number,
  pitch: number,
  yaw: number,
): { x: number; y: number; z: number } {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  return {
    x: x1,
    y: y * cosP - z1 * sinP,
    z: y * sinP + z1 * cosP,
  };
}

/** Facing 0…1 after rotation (1 = toward camera). */
export function rotatedDepth(
  x: number,
  y: number,
  z: number,
  pitch: number,
  yaw: number,
  radius: number,
): number {
  const rotated = rotatePoint(x, y, z, pitch, yaw);
  return (rotated.z / Math.max(1, radius) + 1) / 2;
}

export function rotationToFront(
  x: number,
  y: number,
  z: number,
): { pitch: number; yaw: number } {
  return {
    yaw: -Math.atan2(x, z),
    pitch: Math.atan2(y, Math.hypot(x, z)),
  };
}

export function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch));
}

export function facingOpacity(
  facing: number,
  dimOthers: boolean,
  isFocusedPiece: boolean,
): number {
  if (isFocusedPiece) return 1;
  const base = 0.1 + 0.9 * Math.max(0, facing);
  return dimOthers ? base * 0.32 : base;
}

export function facingScale(facing: number, isFocusedPiece: boolean): number {
  if (isFocusedPiece) return 1.55;
  return 0.72 + 0.28 * Math.max(0, facing);
}

export function projectToScreen(
  x: number,
  y: number,
  z: number,
  pitch: number,
  yaw: number,
  dolly: number,
  viewportWidth: number,
  viewportHeight: number,
  perspective = ORB_PERSPECTIVE,
  originY = ORB_ORIGIN_Y,
): { x: number; y: number; scale: number } {
  const rotated = rotatePoint(x, y, z, pitch, yaw);
  const zCam = rotated.z + dolly;
  const scale = perspective / Math.max(40, perspective - zCam);
  return {
    x: viewportWidth / 2 + rotated.x * scale,
    y: viewportHeight * originY + rotated.y * scale,
    scale,
  };
}

/** Nearest piece in a compass direction using post-rotation X/Y. */
export function findOrbNeighbor(
  placed: OrbWork[],
  fromId: string,
  direction: NavDirection,
  pitch: number,
  yaw: number,
): OrbWork | null {
  const from = placed.find((work) => work.id === fromId);
  if (!from) return null;
  const origin = rotatePoint(from.x, from.y, from.z, pitch, yaw);

  let best: OrbWork | null = null;
  let bestScore = Infinity;

  for (const candidate of placed) {
    if (candidate.id === fromId) continue;
    const point = rotatePoint(candidate.x, candidate.y, candidate.z, pitch, yaw);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;

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

    if (along <= 4) continue;
    const score = along + across * 1.35;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
