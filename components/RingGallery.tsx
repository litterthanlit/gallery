"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { works } from "@/data/works";
import { OrbWork } from "@/components/OrbWork";
import { easeInOutCubic, lerp } from "@/lib/camera";
import { directionFromDelta, type NavDirection } from "@/lib/canvasLayout";
import { lerpAngle } from "@/lib/orbLayout";
import {
  buildTerrain,
  clampPitch,
  frontTile,
  placeOnRing,
  project,
  RELIEF,
  restPitch,
  ringView,
  swell,
  yawToFront,
  type Projected,
  type RingPose,
  type RingTile,
  type RingView,
  type Terrain,
} from "@/lib/ringLayout";

type Viewport = { width: number; height: number };

type Tween = {
  from: RingPose;
  to: RingPose;
  fromAmounts: Map<string, number>;
  toKey: string | null;
  start: number;
  duration: number;
};

type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  moved: boolean;
  base: RingPose;
};

const IDLE_YAW = 0.2;
const INTRO_SECONDS = 1.8;
const INTRO_SPIN = 0.7;
const FOCUS_PITCH = 0.16;
const FOCUS_DURATION = 760;
const HOP_DURATION = 600;
const UNFOCUS_DURATION = 520;
const PITCH_SENSITIVITY = 0.0028;
const FOCUS_DRAG_SENSITIVITY = 0.0018;
const INERTIA_FRICTION = 0.94;
const INERTIA_MIN = 0.01;
const AUTO_SPIN_SPEED = 0.045;
const AUTO_SPIN_DELAY = 2600;
const AUTO_SPIN_RAMP = 1800;
const SWIPE_MIN_DISTANCE = 56;
const DRAG_THRESHOLD = 4;
const HOVER_LIFT = 0.08;
const FOCUS_DIM = 0.85;
const WHEEL_EXIT = 90;
const PINCH_EXIT = 70;
/** Line opacity steps, from the flat plain up to the peaks. */
const LINE_BUCKETS = 6;

function clampDolly(value: number, radius: number): number {
  return Math.min(radius * 0.55, Math.max(-radius * 0.7, value));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Size a canvas's backing store to its CSS box at the device pixel ratio. */
function sizeCanvas(canvas: HTMLCanvasElement, viewport: Viewport, dpr: number) {
  const width = Math.round(viewport.width * dpr);
  const height = Math.round(viewport.height * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

type RingGalleryProps = {
  /** Work id from the URL to open (null = overview). */
  requestedWork: string | null;
  /** Called with the open work's id (or null) whenever focus changes here. */
  onFocusChange: (workId: string | null) => void;
};

export function RingGallery({ requestedWork, onFocusChange }: RingGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const farRef = useRef<HTMLCanvasElement>(null);
  const nearRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);

  const compact = (viewport?.width ?? 1200) < 640;
  const view = useMemo(
    () => (viewport ? ringView(viewport.width, viewport.height) : null),
    [viewport],
  );
  const tiles = useMemo(
    () => (viewport ? placeOnRing(works, viewport.width, viewport.height) : []),
    [viewport],
  );
  const terrain = useMemo(
    () => (view ? buildTerrain(view.radius, compact) : null),
    [compact, view],
  );

  // Animation state lives in refs; the frame loop reads and paints it.
  const tilesRef = useRef<RingTile[]>([]);
  const viewRef = useRef<RingView | null>(null);
  const terrainRef = useRef<Terrain | null>(null);
  const viewportSizeRef = useRef<Viewport>({ width: 0, height: 0 });
  const dprRef = useRef(1);
  const inkRef = useRef("#1a1917");
  const poseRef = useRef<RingPose>({ yaw: IDLE_YAW, pitch: 0.26, dolly: 0 });
  const restPitchRef = useRef(0.26);
  const dollyTargetRef = useRef(0);
  const velocityRef = useRef({ yaw: 0, pitch: 0 });
  const focusAmountsRef = useRef(new Map<string, number>());
  const hoverAmountsRef = useRef(new Map<string, number>());
  const tweenRef = useRef<Tween | null>(null);
  const introRef = useRef(0);
  const clockRef = useRef(0);
  const dirtyRef = useRef(true);
  const lastInteractionRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const focusedKeyRef = useRef<string | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const elementsRef = useRef(new Map<string, HTMLButtonElement>());
  const appliedWidthRef = useRef(new Map<string, number>());
  const appliedInteractiveRef = useRef(new Map<string, boolean>());
  const appliedLayerRef = useRef(new Map<string, number>());
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; dolly: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);
  const wheelNavAtRef = useRef(0);
  const wheelExitRef = useRef({ total: 0, at: 0 });
  const onFocusChangeRef = useRef(onFocusChange);
  const focusTileRef = useRef<(key: string) => void>(() => {});
  const unfocusRef = useRef<() => void>(() => {});
  const projectedRef = useRef<Projected>({ x: 0, y: 0, side: 0, depth: 0, scale: 1 });
  const compactRef = useRef(compact);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    if (!viewport || !view) return;
    const first = viewRef.current === null;
    tilesRef.current = tiles;
    viewRef.current = view;
    terrainRef.current = terrain;
    viewportSizeRef.current = viewport;
    compactRef.current = viewport.width < 640;
    // Hairlines stay crisp at 1.5x and it halves the fill cost of a 2x canvas.
    dprRef.current = Math.min(1.5, window.devicePixelRatio || 1);
    for (const canvas of [farRef.current, nearRef.current]) {
      if (canvas) sizeCanvas(canvas, viewport, dprRef.current);
    }
    if (farRef.current) inkRef.current = getComputedStyle(farRef.current).color;
    const pitch = restPitch(viewport.width, viewport.height);
    if (first || focusedKeyRef.current === null) {
      restPitchRef.current = pitch;
      if (first) poseRef.current = { ...poseRef.current, pitch };
    }
    dirtyRef.current = true;
  }, [terrain, tiles, view, viewport]);

  // Follow the URL: open the requested work (its copy nearest the front), or
  // return to the overview when it's cleared (e.g. the Back button).
  useEffect(() => {
    if (tiles.length === 0) return;
    const current = focusedKeyRef.current
      ? tiles.find((tile) => tile.key === focusedKeyRef.current)?.id ?? null
      : null;
    if (current === requestedWork) return;
    if (!requestedWork) {
      unfocusRef.current();
      return;
    }
    const copy = frontTile(
      tiles.filter((tile) => tile.id === requestedWork),
      poseRef.current.yaw,
    );
    if (copy) focusTileRef.current(copy.key);
  }, [requestedWork, tiles]);

  const markInteraction = useCallback(() => {
    lastInteractionRef.current = performance.now();
  }, []);

  const setPose = useCallback((next: RingPose) => {
    poseRef.current = {
      yaw: next.yaw,
      pitch: clampPitch(next.pitch),
      dolly: clampDolly(next.dolly, viewRef.current?.radius ?? 0),
    };
    dirtyRef.current = true;
  }, []);

  /** Stop a running tween, landing focus amounts where they were headed. */
  const stopTween = useCallback(() => {
    const tween = tweenRef.current;
    if (!tween) return;
    tweenRef.current = null;
    const amounts = focusAmountsRef.current;
    amounts.clear();
    if (tween.toKey) amounts.set(tween.toKey, 1);
    dollyTargetRef.current = poseRef.current.dolly;
    dirtyRef.current = true;
  }, []);

  const animateTo = useCallback(
    (to: RingPose, toKey: string | null, duration: number) => {
      velocityRef.current = { yaw: 0, pitch: 0 };
      tweenRef.current = {
        from: { ...poseRef.current },
        to: {
          yaw: to.yaw,
          pitch: clampPitch(to.pitch),
          dolly: clampDolly(to.dolly, viewRef.current?.radius ?? 0),
        },
        fromAmounts: new Map(focusAmountsRef.current),
        toKey,
        start: performance.now(),
        duration: reducedMotionRef.current ? 1 : duration,
      };
      dirtyRef.current = true;
    },
    [],
  );

  const focusTile = useCallback(
    (key: string) => {
      const tile = tilesRef.current.find((item) => item.key === key);
      if (!tile) return;
      const hopping = focusedKeyRef.current !== null;
      if (!hopping) restPitchRef.current = poseRef.current.pitch;
      focusedKeyRef.current = key;
      setFocusedKey(key);
      setHintVisible(false);
      onFocusChangeRef.current(tile.id);
      markInteraction();
      animateTo(
        {
          yaw: yawToFront(tile.angle),
          pitch: FOCUS_PITCH,
          dolly: (viewRef.current?.radius ?? 0) * 0.3,
        },
        key,
        hopping ? HOP_DURATION : FOCUS_DURATION,
      );
    },
    [animateTo, markInteraction],
  );

  const unfocus = useCallback(() => {
    if (focusedKeyRef.current === null) return;
    focusedKeyRef.current = null;
    setFocusedKey(null);
    onFocusChangeRef.current(null);
    markInteraction();
    animateTo(
      { yaw: poseRef.current.yaw, pitch: restPitchRef.current, dolly: 0 },
      null,
      UNFOCUS_DURATION,
    );
  }, [animateTo, markInteraction]);

  useEffect(() => {
    focusTileRef.current = focusTile;
    unfocusRef.current = unfocus;
  }, [focusTile, unfocus]);

  /** Step along the ring: right/down is the next piece, left/up the previous. */
  const hop = useCallback(
    (direction: NavDirection) => {
      const current = focusedKeyRef.current;
      const list = tilesRef.current;
      const from = list.find((tile) => tile.key === current);
      if (!from) return;
      const step = direction === "left" || direction === "up" ? -1 : 1;
      const next = list[(from.index + step + list.length) % list.length];
      if (next) focusTile(next.key);
    },
    [focusTile],
  );

  const turnBy = useCallback(
    (dYaw: number, dPitch: number) => {
      const current = poseRef.current;
      markInteraction();
      setHintVisible(false);
      animateTo(
        { yaw: current.yaw + dYaw, pitch: current.pitch + dPitch, dolly: current.dolly },
        null,
        460,
      );
    },
    [animateTo, markInteraction],
  );

  /** Draw the contour field, split at the ring's center so the near half can pass in front of far pieces. */
  const drawTerrain = useCallback(
    (pose: RingPose, amplitude: number, seconds: number, alpha: number) => {
      const far = farRef.current?.getContext("2d");
      const near = nearRef.current?.getContext("2d");
      const terrain = terrainRef.current;
      const view = viewRef.current;
      if (!far || !near || !terrain || !view) return;

      const { width, height } = viewportSizeRef.current;
      const dpr = dprRef.current;
      const layers = [far, near];
      const lines = layers.map(() =>
        Array.from({ length: LINE_BUCKETS }, () => new Path2D()),
      );
      const dots = layers.map(() => new Path2D());
      const p = projectedRef.current;
      const { starts, ratios, x, z, height: relief } = terrain;

      for (let ring = 0; ring < ratios.length; ring++) {
        const lift = amplitude * swell(ratios[ring]!, seconds);
        const start = starts[ring]!;
        const count = starts[ring + 1]! - start;
        let lastPath: Path2D | null = null;
        let px = 0;
        let py = 0;
        for (let n = 0; n <= count; n++) {
          const index = start + (n % count);
          const h = relief[index]!;
          project(x[index]!, -h * lift, z[index]!, pose, view, p);
          const layer = p.side < 0 ? 0 : 1;
          if (n > 0) {
            const bucket = Math.min(LINE_BUCKETS - 1, Math.floor(h * LINE_BUCKETS));
            const path = lines[layer]![bucket]!;
            if (path !== lastPath) path.moveTo(px, py);
            path.lineTo(p.x, p.y);
            lastPath = path;
          }
          if (n % 3 === 0 && n < count) {
            const size = Math.min(2.4, 0.95 * p.scale);
            dots[layer]!.rect(p.x - size / 2, p.y - size / 2, size, size);
          }
          px = p.x;
          py = p.y;
        }
      }

      layers.forEach((ctx, layer) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = inkRef.current;
        ctx.fillStyle = inkRef.current;
        ctx.lineWidth = 0.7;
        ctx.lineJoin = "round";
        lines[layer]!.forEach((path, bucket) => {
          ctx.globalAlpha = alpha * (0.14 + 0.66 * (bucket / (LINE_BUCKETS - 1)) ** 1.1);
          ctx.stroke(path);
        });
        ctx.globalAlpha = alpha * 0.4;
        ctx.fill(dots[layer]!);
      });
    },
    [],
  );

  /** Paint the terrain and write every tile's transform straight to the DOM. Returns true while hover easing is still settling. */
  const paint = useCallback(
    (dt: number): boolean => {
      const view = viewRef.current;
      const list = tilesRef.current;
      if (!view || list.length === 0) return false;

      const r = view.radius;
      const intro = easeOutCubic(introRef.current);
      const pose = {
        ...poseRef.current,
        yaw: poseRef.current.yaw - (1 - intro) * INTRO_SPIN,
      };
      const seconds = clockRef.current;
      const amplitude = RELIEF * r * intro;
      const amounts = focusAmountsRef.current;
      const focused = focusedKeyRef.current;
      const hovered = focused === null ? hoveredKeyRef.current : null;
      let dim = 0;
      for (const value of amounts.values()) dim = Math.max(dim, value);

      drawTerrain(pose, amplitude, seconds, Math.min(1, intro * 1.4) * (1 - 0.6 * dim));

      const { width: vw, height: vh } = viewportSizeRef.current;
      const restLayoutScale = view.perspective / (view.perspective - r);
      const crestLift = amplitude * swell(1, seconds);
      const p = projectedRef.current;
      let hoverSettling = false;
      let titleY = 0;
      let titleTile: RingTile | null = null;

      for (const tile of list) {
        const el = elementsRef.current.get(tile.key);
        if (!el) continue;

        project(
          Math.sin(tile.angle) * r,
          -tile.crest * crestLift - r * 0.03,
          Math.cos(tile.angle) * r,
          pose,
          view,
          p,
        );
        const facing = (p.side / r + 1) / 2;
        const amount = amounts.get(tile.key) ?? 0;

        const hoverTarget = tile.key === hovered ? 1 : 0;
        let hover = hoverAmountsRef.current.get(tile.key) ?? 0;
        if (hover !== hoverTarget) {
          hover += (hoverTarget - hover) * Math.min(1, dt * 14);
          if (Math.abs(hoverTarget - hover) < 0.002) hover = hoverTarget;
          else hoverSettling = true;
          hoverAmountsRef.current.set(tile.key, hover);
        }

        // Tiles stand on the ridge: anchored at their bottom edge.
        const restWidth = tile.tileWidth * p.scale * (1 + HOVER_LIFT * hover);
        const restCenterY = p.y - restWidth / tile.aspect / 2 - hover * 6;
        const width = lerp(restWidth, tile.focusWidth, amount);
        const height = width / tile.aspect;
        const centerX = lerp(p.x, vw / 2, amount);
        const centerY = lerp(restCenterY, vh / 2 - (compactRef.current ? 8 : 18), amount);

        // Lay out at focus size while (un)focusing so the image stays sharp;
        // the transform only ever scales down.
        const layoutWidth =
          amount > 0 ? tile.focusWidth : tile.tileWidth * restLayoutScale * (1 + HOVER_LIFT);
        if (appliedWidthRef.current.get(tile.key) !== layoutWidth) {
          appliedWidthRef.current.set(tile.key, layoutWidth);
          el.style.width = `${layoutWidth}px`;
          el.style.height = `${layoutWidth / tile.aspect}px`;
        }

        const restingOpacity =
          (0.28 + 0.72 * smoothstep(facing * 1.15)) * (1 - FOCUS_DIM * (dim - amount));
        const opacity = lerp(restingOpacity, 1, amount) * smoothstep((intro - 0.3) / 0.6);
        el.style.transform = `translate3d(${(centerX - width / 2).toFixed(2)}px, ${(centerY - height / 2).toFixed(2)}px, 0) scale(${(width / layoutWidth).toFixed(4)})`;
        el.style.opacity = opacity.toFixed(3);

        // Far pieces sit under the near half of the terrain; near ones over it.
        const depthRank = Math.max(0, Math.min(800, Math.round((p.depth / r + 2) * 150)));
        const layer = amount > 0 ? 5000 : (p.side < 0 ? 100 : 2000) + depthRank;
        if (appliedLayerRef.current.get(tile.key) !== layer) {
          appliedLayerRef.current.set(tile.key, layer);
          el.style.zIndex = String(layer);
        }

        const interactive =
          focused === null ? opacity > 0.3 && intro > 0.85 : tile.key === focused;
        if (appliedInteractiveRef.current.get(tile.key) !== interactive) {
          appliedInteractiveRef.current.set(tile.key, interactive);
          el.style.pointerEvents = interactive ? "auto" : "none";
          el.tabIndex = interactive ? 0 : -1;
        }

        if (tile.key === focused) {
          titleTile = tile;
          titleY = centerY + height / 2 + 22;
        }
      }

      const title = titleRef.current;
      if (title) {
        if (titleTile) {
          const reveal = smoothstep(((amounts.get(titleTile.key) ?? 0) - 0.6) / 0.4);
          title.style.transform = `translate3d(${(vw / 2).toFixed(1)}px, ${(titleY + (1 - reveal) * 8).toFixed(1)}px, 0) translateX(-50%)`;
          title.style.opacity = reveal.toFixed(3);
        } else {
          title.style.opacity = "0";
        }
      }

      return hoverSettling;
    },
    [drawTerrain],
  );

  // Measure; tiles render only after this so server and client markup match.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotionRef.current = query.matches;
      if (query.matches) introRef.current = 1;
      dirtyRef.current = true;
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // One loop drives intro, tweens, inertia, idle drift, the swell, and painting.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    lastInteractionRef.current = last;

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const reduced = reducedMotionRef.current;
      let dirty = dirtyRef.current;
      dirtyRef.current = false;

      // The terrain breathes, so it repaints every frame unless motion is reduced.
      if (!reduced && viewRef.current) {
        clockRef.current += dt;
        dirty = true;
      }

      if (tilesRef.current.length > 0 && introRef.current < 1) {
        introRef.current = reduced ? 1 : Math.min(1, introRef.current + dt / INTRO_SECONDS);
        dirty = true;
      }

      const tween = tweenRef.current;
      const pose = poseRef.current;
      if (tween) {
        const t = Math.min(1, (now - tween.start) / tween.duration);
        const eased = easeInOutCubic(t);
        poseRef.current = {
          yaw: lerpAngle(tween.from.yaw, tween.to.yaw, eased),
          pitch: lerp(tween.from.pitch, tween.to.pitch, eased),
          dolly: lerp(tween.from.dolly, tween.to.dolly, eased),
        };
        const amounts = focusAmountsRef.current;
        amounts.clear();
        for (const [key, value] of tween.fromAmounts) {
          if (key !== tween.toKey) amounts.set(key, value * (1 - eased));
        }
        if (tween.toKey) {
          const from = tween.fromAmounts.get(tween.toKey) ?? 0;
          amounts.set(tween.toKey, lerp(from, 1, eased));
        }
        if (t >= 1) {
          tweenRef.current = null;
          amounts.clear();
          if (tween.toKey) amounts.set(tween.toKey, 1);
          dollyTargetRef.current = poseRef.current.dolly;
        }
        dirty = true;
      } else if (!dragRef.current && !pinchRef.current) {
        const velocity = velocityRef.current;
        const speed = Math.hypot(velocity.yaw, velocity.pitch);
        let next = pose;
        if (speed > INERTIA_MIN && !reduced) {
          const decay = Math.pow(INERTIA_FRICTION, dt * 60);
          velocity.yaw *= decay;
          velocity.pitch *= decay;
          next = {
            ...next,
            yaw: next.yaw + velocity.yaw * dt,
            pitch: next.pitch + velocity.pitch * dt,
          };
        } else if (
          !reduced &&
          focusedKeyRef.current === null &&
          hoveredKeyRef.current === null
        ) {
          const idleFor = now - lastInteractionRef.current;
          if (idleFor > AUTO_SPIN_DELAY) {
            const ramp = Math.min(1, (idleFor - AUTO_SPIN_DELAY) / AUTO_SPIN_RAMP);
            next = {
              ...next,
              yaw: next.yaw + AUTO_SPIN_SPEED * ramp * dt,
              pitch:
                next.pitch +
                (restPitchRef.current - next.pitch) * Math.min(1, dt * 0.5) * ramp,
            };
          }
        }
        const dollyGap = dollyTargetRef.current - next.dolly;
        if (Math.abs(dollyGap) > 0.1) {
          next = { ...next, dolly: next.dolly + dollyGap * (reduced ? 1 : Math.min(1, dt * 12)) };
        }
        if (next !== pose) {
          setPose(next);
          dirty = true;
        }
      }

      if (dirty && paint(dt)) dirtyRef.current = true;
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paint, setPose]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      unfocus();
      return;
    }

    const arrows: Record<string, NavDirection> = {
      ArrowRight: "right",
      ArrowLeft: "left",
      ArrowDown: "down",
      ArrowUp: "up",
    };
    const direction = arrows[event.key];

    if (focusedKeyRef.current) {
      if (direction) {
        event.preventDefault();
        hop(direction);
      }
      return;
    }

    if (direction) {
      event.preventDefault();
      // One slot per press, so the arrows walk the ring piece by piece.
      const slot = (Math.PI * 2) / Math.max(1, tilesRef.current.length);
      if (direction === "left") turnBy(slot, 0);
      else if (direction === "right") turnBy(-slot, 0);
      else if (direction === "up") turnBy(0, -0.12);
      else turnBy(0, 0.12);
      return;
    }

    if (
      (event.key === "Enter" || event.key === " ") &&
      document.activeElement === viewportRef.current
    ) {
      event.preventDefault();
      const tile = frontTile(tilesRef.current, poseRef.current.yaw);
      if (tile) focusTile(tile.key);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setHintVisible(false);
      markInteraction();
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      const r = viewRef.current?.radius ?? 1;

      if (focusedKeyRef.current) {
        if (absX > absY && absX > 12) {
          const now = performance.now();
          if (now - wheelNavAtRef.current < 420) return;
          wheelNavAtRef.current = now;
          hop(event.deltaX > 0 ? "right" : "left");
          return;
        }
        // Scrolling "out" past a small threshold backs out of focus.
        const now = performance.now();
        const exit = wheelExitRef.current;
        if (now - exit.at > 220) exit.total = 0;
        exit.at = now;
        exit.total += event.deltaY * (event.ctrlKey ? 3 : 1);
        if (exit.total > WHEEL_EXIT) {
          exit.total = 0;
          unfocus();
        }
        return;
      }

      stopTween();
      if (absX > absY) {
        setPose({ ...poseRef.current, yaw: poseRef.current.yaw - event.deltaX / (r * 1.4) });
        return;
      }
      const zoom = event.deltaY * (event.ctrlKey ? 2.4 : 0.6);
      dollyTargetRef.current = clampDolly(dollyTargetRef.current - zoom, r);
      dirtyRef.current = true;
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [hop, markInteraction, setPose, stopTween, unfocus]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    markInteraction();

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchRef.current = {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        dolly: dollyTargetRef.current,
      };
      dragRef.current = null;
      suppressClickRef.current = true;
      setIsSpinning(false);
      return;
    }
    if (pointers.size > 2) return;

    suppressClickRef.current = false;
    // Grabbing the ring catches it mid-turn.
    velocityRef.current = { yaw: 0, pitch: 0 };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: false,
      base: { ...poseRef.current },
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const r = viewRef.current?.radius ?? 1;

    const pinch = pinchRef.current;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const delta = distance - pinch.distance;
      setHintVisible(false);
      markInteraction();
      if (focusedKeyRef.current) {
        if (delta < -PINCH_EXIT) {
          pinchRef.current = { distance, dolly: 0 };
          unfocus();
        }
        return;
      }
      dollyTargetRef.current = clampDolly(pinch.dolly + delta * 0.8, r);
      dirtyRef.current = true;
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const totalX = event.clientX - drag.startX;
    const totalY = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.hypot(totalX, totalY) <= DRAG_THRESHOLD) return;
      drag.moved = true;
      suppressClickRef.current = true;
      // Capture only once it's a drag so plain taps still click their tile.
      event.currentTarget.setPointerCapture(event.pointerId);
      stopTween();
      drag.base = { ...poseRef.current };
      setHintVisible(false);
      setIsSpinning(true);
    }

    markInteraction();
    if (focusedKeyRef.current) {
      // Rubber-band: the ring leans with the finger, then hops or settles.
      setPose({
        ...drag.base,
        yaw: drag.base.yaw + totalX * FOCUS_DRAG_SENSITIVITY,
      });
    } else {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      const seconds = Math.max(0.008, (now - drag.lastT) / 1000);
      const current = poseRef.current;
      // The front of the ring follows the finger.
      const yawDelta = dx / (r * 1.4);
      const pitchDelta = dy * PITCH_SENSITIVITY;
      const velocity = velocityRef.current;
      velocity.yaw = lerp(velocity.yaw, yawDelta / seconds, 0.6);
      velocity.pitch = lerp(velocity.pitch, pitchDelta / seconds, 0.6);
      setPose({
        yaw: current.yaw + yawDelta,
        pitch: current.pitch + pitchDelta,
        dolly: current.dolly,
      });
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastT = now;
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.delete(event.pointerId)) return;

    if (pinchRef.current) {
      if (pointers.size < 2) pinchRef.current = null;
      dragRef.current = null;
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsSpinning(false);
    if (!drag.moved) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const focused = focusedKeyRef.current;
    if (focused) {
      const direction = directionFromDelta(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        SWIPE_MIN_DISTANCE,
      );
      if (direction) hop(direction);
      else focusTile(focused);
      return;
    }

    // A pause before release means the fling has already stopped.
    if (performance.now() - drag.lastT > 90) {
      velocityRef.current = { yaw: 0, pitch: 0 };
    }
  };

  const onBackgroundClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    unfocus();
  };

  const onSelect = useCallback(
    (key: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (focusedKeyRef.current === key) unfocus();
      else focusTile(key);
    },
    [focusTile, unfocus],
  );

  const onHover = useCallback((key: string | null) => {
    hoveredKeyRef.current = key;
    setHoveredKey(key);
    if (key) lastInteractionRef.current = performance.now();
    dirtyRef.current = true;
  }, []);

  const register = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) {
      elementsRef.current.set(key, el);
    } else {
      elementsRef.current.delete(key);
    }
    appliedWidthRef.current.delete(key);
    appliedInteractiveRef.current.delete(key);
    appliedLayerRef.current.delete(key);
    dirtyRef.current = true;
  }, []);

  const focusedTile = focusedKey
    ? tiles.find((tile) => tile.key === focusedKey) ?? null
    : null;
  const hoveredTile =
    !focusedTile && hoveredKey
      ? tiles.find((tile) => tile.key === hoveredKey) ?? null
      : null;
  const catalogIndex = focusedTile
    ? works.findIndex((work) => work.id === focusedTile.id)
    : -1;

  return (
    <>
      <div
        ref={viewportRef}
        className={`canvas-viewport ring-viewport${isSpinning ? " is-panning" : ""}${focusedTile ? " is-focused" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={onBackgroundClick}
        tabIndex={0}
        role="application"
        aria-roledescription="3D gallery"
        aria-label="Art ring"
        aria-describedby="ring-instructions"
      >
        <p id="ring-instructions" className="sr-only">
          Left and right arrow keys turn the ring one piece at a time; up and
          down tilt it. Enter opens the piece in front. Tab moves between
          pieces. In a piece, arrow keys move to the next or previous piece and
          Escape returns to the ring.
        </p>
        <canvas ref={farRef} className="ring-terrain ring-terrain-far" aria-hidden="true" />
        <canvas ref={nearRef} className="ring-terrain ring-terrain-near" aria-hidden="true" />
        {tiles.map((tile) => (
          <OrbWork
            key={tile.key}
            tile={tile}
            variant="ring-work"
            focused={tile.key === focusedKey}
            register={register}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
      </div>

      <div
        ref={titleRef}
        className="orb-title"
        style={{ fontSize: compact ? 14 : 15 }}
        aria-hidden="true"
      >
        {focusedTile ? (
          <>
            <span className="canvas-work-name-title">{focusedTile.title}</span>
            <span className="canvas-work-name-year">{focusedTile.year}</span>
          </>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {focusedTile
          ? `${focusedTile.title}, ${focusedTile.year}. ${catalogIndex + 1} of ${works.length}.`
          : ""}
      </p>

      {hoveredTile ? (
        <p key={hoveredTile.key} className="canvas-hint orb-hover-label" aria-hidden="true">
          {hoveredTile.title}
          <span className="orb-hover-year">{hoveredTile.year}</span>
        </p>
      ) : hintVisible && !focusedTile ? (
        <p className="canvas-hint">
          {compact
            ? "Drag to turn · tap a piece"
            : "Drag to turn · scroll to zoom · click a piece"}
        </p>
      ) : null}

      {focusedTile ? (
        <>
          <div
            className={`canvas-caption${focusedTile.note ? "" : " canvas-caption-meta-only"}`}
          >
            {focusedTile.note ? (
              <p className="canvas-caption-note">{focusedTile.note}</p>
            ) : null}
            <div className="canvas-caption-meta">
              <span className="canvas-caption-index">
                {String(catalogIndex + 1).padStart(2, "0")} /{" "}
                {String(works.length).padStart(2, "0")}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="orb-close"
            aria-label="Back to the ring"
            aria-keyshortcuts="Escape"
            onClick={(event) => {
              event.stopPropagation();
              unfocus();
            }}
          >
            <span aria-hidden="true">← Ring</span>
            <kbd className="orb-close-key" aria-hidden="true">
              Esc
            </kbd>
          </button>

          <div className="canvas-focus-nav">
            <button
              type="button"
              className="canvas-nav-btn"
              onClick={(event) => {
                event.stopPropagation();
                hop("left");
              }}
              aria-label="Previous work"
            >
              ‹
            </button>
            <button
              type="button"
              className="canvas-nav-btn"
              onClick={(event) => {
                event.stopPropagation();
                hop("right");
              }}
              aria-label="Next work"
            >
              ›
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
