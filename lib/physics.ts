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

const FRICTION = 1.85; // linear damping (1/s)
const ANGULAR_FRICTION = 2.4;
const RESTITUTION = 0.28;
const FRICTION_TANGENT = 0.18;
const SLEEP_SPEED = 8;
const SLEEP_OMEGA = 0.04;
const MAX_SPEED = 2800;
const MAX_OMEGA = 8;
const COLLISION_ITERATIONS = 6;
const POSITION_SLOP = 0.6;
const POSITION_PERCENT = 0.72;
const VELOCITY_SMOOTH = 0.55;

function massForSize(w: number, h: number): number {
  return Math.max(0.4, (w * h) / (380 * 380));
}

export function createWorld(placed: PlacedWork[]): PhysicsWorld {
  const world = createEmptyWorld();
  for (const work of placed) {
    upsertBody(world, work);
  }
  return world;
}

export function createEmptyWorld(): PhysicsWorld {
  return { bodies: [], byId: new Map() };
}

export function upsertBody(
  world: PhysicsWorld,
  work: PlacedWork,
  pose?: {
    x: number;
    y: number;
    angle: number;
    vx?: number;
    vy?: number;
    omega?: number;
  },
): PhysicsBody {
  const existing = world.byId.get(work.id);
  if (existing) {
    existing.w = work.displayWidth;
    existing.h = work.displayHeight;
    existing.mass = massForSize(existing.w, existing.h);
    existing.invMass = 1 / existing.mass;
    if (pose) {
      existing.x = pose.x;
      existing.y = pose.y;
      existing.angle = pose.angle;
      if (pose.vx !== undefined) existing.vx = pose.vx;
      if (pose.vy !== undefined) existing.vy = pose.vy;
      if (pose.omega !== undefined) existing.omega = pose.omega;
    }
    return existing;
  }

  const mass = massForSize(work.displayWidth, work.displayHeight);
  const body: PhysicsBody = {
    id: work.id,
    x: pose?.x ?? work.x,
    y: pose?.y ?? work.y,
    w: work.displayWidth,
    h: work.displayHeight,
    vx: pose?.vx ?? 0,
    vy: pose?.vy ?? 0,
    angle: pose?.angle ?? 0,
    omega: pose?.omega ?? 0,
    mass,
    invMass: 1 / mass,
  };
  world.bodies.push(body);
  world.byId.set(body.id, body);
  return body;
}

export function removeBody(world: PhysicsWorld, id: string): PhysicsBody | null {
  const body = world.byId.get(id);
  if (!body) return null;
  world.byId.delete(id);
  world.bodies = world.bodies.filter((item) => item.id !== id);
  return body;
}

/**
 * Keep physics bodies aligned with the currently visible map instances.
 * `memory` preserves poses when chunks stream out and back in.
 */
export function syncWorldToInstances(
  world: PhysicsWorld,
  instances: PlacedWork[],
  memory: Map<string, { x: number; y: number; angle: number }>,
  keepIds: Set<string>,
) {
  const desired = new Set(instances.map((item) => item.id));
  for (const id of keepIds) desired.add(id);

  for (const body of [...world.bodies]) {
    if (desired.has(body.id)) continue;
    memory.set(body.id, { x: body.x, y: body.y, angle: body.angle });
    removeBody(world, body.id);
  }

  for (const instance of instances) {
    if (world.byId.has(instance.id)) continue;
    const remembered = memory.get(instance.id);
    upsertBody(world, instance, remembered);
  }
}

export function clonePositions(world: PhysicsWorld): Map<
  string,
  {
    x: number;
    y: number;
    angle: number;
  }
> {
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

  if (dt > 0 && dt < 0.064) {
    const measuredVx = (nextX - body.x) / dt;
    const measuredVy = (nextY - body.y) / dt;
    body.vx = mix(body.vx, measuredVx, VELOCITY_SMOOTH);
    body.vy = mix(body.vy, measuredVy, VELOCITY_SMOOTH);

    // Gentle torque from off-center grab motion (visual only).
    const cx = body.x + body.w / 2;
    const cy = body.y + body.h / 2;
    const rx = prevWorldX - cx;
    const ry = prevWorldY - cy;
    const moveX = worldX - prevWorldX;
    const moveY = worldY - prevWorldY;
    const torque = rx * moveY - ry * moveX;
    const inertia = body.mass * ((body.w * body.w + body.h * body.h) / 12);
    body.omega = mix(
      body.omega,
      body.omega + torque / Math.max(inertia, 1),
      0.35,
    );
  }

  body.x = nextX;
  body.y = nextY;
  clampMotion(body);
}

export function releaseBody(
  body: PhysicsBody,
  samples: Array<{ t: number; x: number; y: number }>,
) {
  if (samples.length < 2) {
    clampMotion(body);
    return;
  }

  const last = samples[samples.length - 1]!;
  // Prefer a window ~70ms back so a soft finger-stop doesn't kill the toss.
  let first = samples[0]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    const sample = samples[i]!;
    if (last.t - sample.t >= 70) {
      first = sample;
      break;
    }
    first = sample;
  }

  const dt = Math.max(0.012, (last.t - first.t) / 1000);
  const throwVx = (last.x - first.x) / dt;
  const throwVy = (last.y - first.y) / dt;

  // Blend measured throw with the smoothed in-drag velocity.
  body.vx = mix(body.vx, throwVx, 0.7);
  body.vy = mix(body.vy, throwVy, 0.7);

  const cx = body.x + body.w / 2;
  const cy = body.y + body.h / 2;
  const rx = last.x - cx;
  const ry = last.y - cy;
  const inertia = body.mass * ((body.w * body.w + body.h * body.h) / 12);
  const spinFromThrow = (rx * body.vy - ry * body.vx) / Math.max(inertia * 4, 1);
  body.omega = mix(body.omega, body.omega + spinFromThrow, 0.45);
  clampMotion(body);
}

/** Integrate velocities, resolve AABB collisions. Returns true if anything moved. */
export function stepWorld(
  world: PhysicsWorld,
  dt: number,
  grabbedId: string | null,
): boolean {
  if (dt <= 0) return grabbedId !== null;

  // Substep for stability when the frame hitch is large.
  const steps = dt > 0.02 ? 2 : 1;
  const stepDt = dt / steps;
  let awake = false;

  for (let step = 0; step < steps; step++) {
    if (integrate(world, stepDt, grabbedId)) awake = true;
    if (resolveAllCollisions(world, grabbedId)) awake = true;
  }

  return awake || grabbedId !== null;
}

function integrate(
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
      // Keep angles from growing without bound (visual only).
      if (body.angle > Math.PI * 4 || body.angle < -Math.PI * 4) {
        body.angle = ((body.angle + Math.PI) % (Math.PI * 2)) - Math.PI;
      }
      awake = true;
    }
  }

  return awake;
}

function resolveAllCollisions(
  world: PhysicsWorld,
  grabbedId: string | null,
): boolean {
  let hit = false;
  const bodies = world.bodies;
  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    let iterHit = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (resolveCollision(bodies[i]!, bodies[j]!, grabbedId)) {
          iterHit = true;
        }
      }
    }
    if (!iterHit) break;
    hit = true;
  }
  return hit;
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

  // Normal points from A → B (standard impulse convention).
  let nx = 0;
  let ny = 0;
  let penetration = 0;
  if (overlapX < overlapY) {
    penetration = overlapX;
    nx = a.x + a.w / 2 < b.x + b.w / 2 ? 1 : -1;
  } else {
    penetration = overlapY;
    ny = a.y + a.h / 2 < b.y + b.h / 2 ? 1 : -1;
  }

  const invA = aGrabbed ? 0 : a.invMass;
  const invB = bGrabbed ? 0 : b.invMass;
  const invSum = invA + invB;
  if (invSum <= 0) return false;

  // Positional correction along normal, with slop to avoid micro-jitter.
  const correction = Math.max(penetration - POSITION_SLOP, 0) * POSITION_PERCENT;
  if (correction > 0) {
    const cx = (correction * nx) / invSum;
    const cy = (correction * ny) / invSum;
    if (!aGrabbed) {
      a.x -= cx * invA;
      a.y -= cy * invA;
    }
    if (!bGrabbed) {
      b.x += cx * invB;
      b.y += cy * invB;
    }
  }

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  // Only apply impulse when approaching.
  if (velAlongNormal < 0) {
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

    // Coulomb-ish tangent friction so pieces don't skate forever after a hit.
    const tx = -ny;
    const ty = nx;
    const rvx2 = b.vx - a.vx;
    const rvy2 = b.vy - a.vy;
    const velAlongTangent = rvx2 * tx + rvy2 * ty;
    const jtMax = Math.abs(j) * FRICTION_TANGENT;
    let jt = -velAlongTangent / invSum;
    jt = clamp(jt, -jtMax, jtMax);

    if (!aGrabbed) {
      a.vx -= jt * tx * invA;
      a.vy -= jt * ty * invA;
    }
    if (!bGrabbed) {
      b.vx += jt * tx * invB;
      b.vy += jt * ty * invB;
    }

    // Small visual spin from impact, scaled by relative speed.
    const impact = Math.abs(velAlongNormal);
    const spinKick = clamp(impact * 0.00008, 0, 0.35);
    const side = nx !== 0 ? Math.sign(rvy) || 1 : Math.sign(rvx) || 1;
    if (!aGrabbed) a.omega -= spinKick * side;
    if (!bGrabbed) b.omega += spinKick * side;
  }

  clampMotion(a);
  clampMotion(b);
  return true;
}

function clampMotion(body: PhysicsBody) {
  body.vx = clamp(body.vx, -MAX_SPEED, MAX_SPEED);
  body.vy = clamp(body.vy, -MAX_SPEED, MAX_SPEED);
  body.omega = clamp(body.omega, -MAX_OMEGA, MAX_OMEGA);
}

function mix(current: number, next: number, amount: number): number {
  return current + (next - current) * amount;
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
