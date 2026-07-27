import type { PlacedWork } from "@/lib/canvasLayout";

export type PhysicsBody = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  /** Visual spin in radians. */
  angle: number;
  omega: number;
  mass: number;
  invMass: number;
};

export type PhysicsWorld = {
  bodies: PhysicsBody[];
  byId: Map<string, PhysicsBody>;
};

const FRICTION = 2.4; // linear damping (1/s)
const ANGULAR_FRICTION = 3.2;
const RESTITUTION = 0.42;
const SLEEP_SPEED = 6;
const SLEEP_OMEGA = 0.05;
const MAX_SPEED = 4200;
const MAX_OMEGA = 14;

function massForSize(w: number, h: number): number {
  return Math.max(0.35, (w * h) / (380 * 380));
}

export function createWorld(placed: PlacedWork[]): PhysicsWorld {
  const bodies: PhysicsBody[] = placed.map((work) => {
    const mass = massForSize(work.displayWidth, work.displayHeight);
    return {
      id: work.id,
      x: work.x,
      y: work.y,
      w: work.displayWidth,
      h: work.displayHeight,
      vx: 0,
      vy: 0,
      angle: 0,
      omega: 0,
      mass,
      invMass: 1 / mass,
    };
  });
  return {
    bodies,
    byId: new Map(bodies.map((body) => [body.id, body])),
  };
}

export function clonePositions(world: PhysicsWorld): Map<string, {
  x: number;
  y: number;
  angle: number;
}> {
  const map = new Map<string, { x: number; y: number; angle: number }>();
  for (const body of world.bodies) {
    map.set(body.id, { x: body.x, y: body.y, angle: body.angle });
  }
  return map;
}

export function isWorldAwake(world: PhysicsWorld, grabbedId: string | null): boolean {
  if (grabbedId) return true;
  for (const body of world.bodies) {
    if (
      Math.hypot(body.vx, body.vy) > SLEEP_SPEED ||
      Math.abs(body.omega) > SLEEP_OMEGA
    ) {
      return true;
    }
  }
  return false;
}

export function applyDrag(
  body: PhysicsBody,
  worldX: number,
  worldY: number,
  grabOffsetX: number,
  grabOffsetY: number,
  dt: number,
  prevWorldX: number,
  prevWorldY: number,
) {
  const nextX = worldX - grabOffsetX;
  const nextY = worldY - grabOffsetY;
  if (dt > 0 && dt < 0.08) {
    body.vx = (nextX - body.x) / dt;
    body.vy = (nextY - body.y) / dt;
    // Torque from off-center grab motion.
    const cx = body.x + body.w / 2;
    const cy = body.y + body.h / 2;
    const rx = prevWorldX - cx;
    const ry = prevWorldY - cy;
    const moveX = worldX - prevWorldX;
    const moveY = worldY - prevWorldY;
    const torque = rx * moveY - ry * moveX;
    body.omega += (torque / (body.mass * 18000)) * 60;
  }
  body.x = nextX;
  body.y = nextY;
  body.vx = clamp(body.vx, -MAX_SPEED, MAX_SPEED);
  body.vy = clamp(body.vy, -MAX_SPEED, MAX_SPEED);
  body.omega = clamp(body.omega, -MAX_OMEGA, MAX_OMEGA);
}

export function releaseBody(
  body: PhysicsBody,
  samples: Array<{ t: number; x: number; y: number }>,
) {
  if (samples.length >= 2) {
    const last = samples[samples.length - 1]!;
    const first = samples[Math.max(0, samples.length - 4)]!;
    const dt = Math.max(0.008, (last.t - first.t) / 1000);
    body.vx = clamp((last.x - first.x) / dt, -MAX_SPEED, MAX_SPEED);
    body.vy = clamp((last.y - first.y) / dt, -MAX_SPEED, MAX_SPEED);

    const cx = body.x + body.w / 2;
    const cy = body.y + body.h / 2;
    const rx = last.x - cx;
    const ry = last.y - cy;
    body.omega = clamp(
      body.omega + (rx * body.vy - ry * body.vx) / (body.mass * 22000),
      -MAX_OMEGA,
      MAX_OMEGA,
    );
  }
}

/** Integrate velocities, resolve AABB collisions. Returns true if anything moved. */
export function stepWorld(
  world: PhysicsWorld,
  dt: number,
  grabbedId: string | null,
): boolean {
  const damp = Math.exp(-FRICTION * dt);
  const angDamp = Math.exp(-ANGULAR_FRICTION * dt);
  let awake = false;

  for (const body of world.bodies) {
    if (body.id === grabbedId) {
      awake = true;
      continue;
    }

    body.vx *= damp;
    body.vy *= damp;
    body.omega *= angDamp;

    if (Math.hypot(body.vx, body.vy) < SLEEP_SPEED) {
      body.vx = 0;
      body.vy = 0;
    }
    if (Math.abs(body.omega) < SLEEP_OMEGA) body.omega = 0;

    if (body.vx !== 0 || body.vy !== 0 || body.omega !== 0) {
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.angle += body.omega * dt;
      // Keep spin readable — gently unwind extreme angles over time via damping only.
      awake = true;
    }
  }

  // Pairwise AABB collisions (skip grabbed body as solid — others bounce off it).
  const bodies = world.bodies;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      if (resolveCollision(a, b, grabbedId)) awake = true;
    }
  }

  return awake || grabbedId !== null;
}

function resolveCollision(
  a: PhysicsBody,
  b: PhysicsBody,
  grabbedId: string | null,
): boolean {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;

  const overlapX = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const overlapY = Math.min(ay2, by2) - Math.max(a.y, b.y);
  if (overlapX <= 0 || overlapY <= 0) return false;

  const aGrabbed = a.id === grabbedId;
  const bGrabbed = b.id === grabbedId;

  // Separate along the shallow axis.
  if (overlapX < overlapY) {
    const push = overlapX;
    const dir = a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1;
    separate(a, b, push * dir, 0, aGrabbed, bGrabbed);
    bounce(a, b, dir, 0, aGrabbed, bGrabbed);
  } else {
    const push = overlapY;
    const dir = a.y + a.h / 2 < b.y + b.h / 2 ? -1 : 1;
    separate(a, b, 0, push * dir, aGrabbed, bGrabbed);
    bounce(a, b, 0, dir, aGrabbed, bGrabbed);
  }

  // Transfer a little spin on impact.
  const spinKick = 0.35;
  if (!aGrabbed) a.omega += (b.vx - a.vx) * 0.00015 * spinKick;
  if (!bGrabbed) b.omega += (a.vx - b.vx) * 0.00015 * spinKick;

  return true;
}

function separate(
  a: PhysicsBody,
  b: PhysicsBody,
  dx: number,
  dy: number,
  aGrabbed: boolean,
  bGrabbed: boolean,
) {
  if (aGrabbed && !bGrabbed) {
    b.x -= dx;
    b.y -= dy;
    return;
  }
  if (bGrabbed && !aGrabbed) {
    a.x += dx;
    a.y += dy;
    return;
  }
  const total = a.invMass + b.invMass;
  if (total <= 0) return;
  a.x += (dx * a.invMass) / total;
  a.y += (dy * a.invMass) / total;
  b.x -= (dx * b.invMass) / total;
  b.y -= (dy * b.invMass) / total;
}

function bounce(
  a: PhysicsBody,
  b: PhysicsBody,
  nx: number,
  ny: number,
  aGrabbed: boolean,
  bGrabbed: boolean,
) {
  const invA = aGrabbed ? 0 : a.invMass;
  const invB = bGrabbed ? 0 : b.invMass;
  const invSum = invA + invB;
  if (invSum <= 0) return;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return;

  const j = (-(1 + RESTITUTION) * velAlongNormal) / invSum;
  const ix = j * nx;
  const iy = j * ny;

  if (!aGrabbed) {
    a.vx -= ix * invA;
    a.vy -= iy * invA;
  }
  if (!bGrabbed) {
    b.vx += ix * invB;
    b.vy += iy * invB;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function boundsFromWorld(world: PhysicsWorld) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const body of world.bodies) {
    minX = Math.min(minX, body.x);
    minY = Math.min(minY, body.y);
    maxX = Math.max(maxX, body.x + body.w);
    maxY = Math.max(maxY, body.y + body.h);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
