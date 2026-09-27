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
import {
  clampPitch,
  FACING_POINTER_MIN,
  facingOpacity,
  facingScale,
  findOrbNeighbor,
  focusDolly,
  frontTile,
  lerpAngle,
  ORB_PERSPECTIVE,
  orbRadius,
  perspectiveScale,
  placeOnSphere,
  rotatePoint,
  rotationToFront,
  type OrbTile,
} from "@/lib/orbLayout";

type OrbPose = { pitch: number; yaw: number; dolly: number };
type Viewport = { width: number; height: number };

type Tween = {
  from: OrbPose;
  to: OrbPose;
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
  base: OrbPose;
};

const IDLE_PITCH = 0.18;
const IDLE_YAW = 0.45;
const INTRO_SECONDS = 1.3;
const INTRO_SPIN = 0.9;
const FOCUS_DURATION = 720;
const HOP_DURATION = 560;
const UNFOCUS_DURATION = 480;
const SPIN_SENSITIVITY = 0.0052;
const FOCUS_DRAG_SENSITIVITY = 0.0022;
const INERTIA_FRICTION = 0.94;
const INERTIA_MIN = 0.02;
const AUTO_SPIN_SPEED = 0.07;
const AUTO_SPIN_DELAY = 2600;
const AUTO_SPIN_RAMP = 1800;
const SWIPE_MIN_DISTANCE = 56;
const DRAG_THRESHOLD = 4;
const HOVER_LIFT = 0.09;
const FOCUS_DIM = 0.88;
const WHEEL_EXIT = 90;
const PINCH_EXIT = 70;

function dollyRange(radius: number): { min: number; max: number } {
  return { min: -radius * 1.1, max: radius * 0.45 };
}

function clampDolly(value: number, radius: number): number {
  const { min, max } = dollyRange(radius);
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function OrbGallery() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);

  const radius = viewport ? orbRadius(viewport.width, viewport.height) : 0;
  const tiles = useMemo(
    () =>
      viewport
        ? placeOnSphere(works, radius, viewport.width, viewport.height)
        : [],
    [radius, viewport],
  );

  // Animation state lives in refs; the frame loop reads and paints it.
  const tilesRef = useRef<OrbTile[]>([]);
  const radiusRef = useRef(0);
  const viewportSizeRef = useRef<Viewport>({ width: 0, height: 0 });
  const poseRef = useRef<OrbPose>({ pitch: IDLE_PITCH, yaw: IDLE_YAW, dolly: 0 });
  const dollyTargetRef = useRef(0);
  const velocityRef = useRef({ pitch: 0, yaw: 0 });
  const focusAmountsRef = useRef(new Map<string, number>());
  const hoverAmountsRef = useRef(new Map<string, number>());
  const tweenRef = useRef<Tween | null>(null);
  const introRef = useRef(0);
  const dirtyRef = useRef(true);
  const lastInteractionRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const focusedKeyRef = useRef<string | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const elementsRef = useRef(new Map<string, HTMLButtonElement>());
  const appliedWidthRef = useRef(new Map<string, number>());
  const appliedInteractiveRef = useRef(new Map<string, boolean>());
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; dolly: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);
  const wheelNavAtRef = useRef(0);
  const wheelExitRef = useRef({ total: 0, at: 0 });

  useEffect(() => {
    tilesRef.current = tiles;
    radiusRef.current = radius;
    if (viewport) viewportSizeRef.current = viewport;
    dirtyRef.current = true;
  }, [radius, tiles, viewport]);

  const markInteraction = useCallback(() => {
    lastInteractionRef.current = performance.now();
  }, []);

  const setPose = useCallback((next: OrbPose) => {
    const clamped = {
      pitch: clampPitch(next.pitch),
      yaw: next.yaw,
      dolly: clampDolly(next.dolly, radiusRef.current),
    };
    poseRef.current = clamped;
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
    (to: OrbPose, toKey: string | null, duration: number) => {
      velocityRef.current = { pitch: 0, yaw: 0 };
      tweenRef.current = {
        from: { ...poseRef.current },
        to: {
          pitch: clampPitch(to.pitch),
          yaw: to.yaw,
          dolly: clampDolly(to.dolly, radiusRef.current),
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
      const target = rotationToFront(tile.x, tile.y, tile.z);
      focusedKeyRef.current = key;
      setFocusedKey(key);
      setHintVisible(false);
      markInteraction();
      animateTo(
        { ...target, dolly: focusDolly(radiusRef.current) },
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
    markInteraction();
    const current = poseRef.current;
    animateTo({ ...current, dolly: 0 }, null, UNFOCUS_DURATION);
  }, [animateTo, markInteraction]);

  const hop = useCallback(
    (direction: NavDirection) => {
      const current = focusedKeyRef.current;
      if (!current) return;
      const { pitch, yaw } = poseRef.current;
      const list = tilesRef.current;
      const neighbor =
        findOrbNeighbor(list, current, direction, pitch, yaw) ??
        (() => {
          // Nothing visible that way — step through the catalog instead.
          const from = list.find((tile) => tile.key === current);
          if (!from) return null;
          const index = works.findIndex((work) => work.id === from.id);
          const step = direction === "left" || direction === "up" ? -1 : 1;
          const nextId = works[(index + step + works.length) % works.length]?.id;
          return list.find((tile) => tile.id === nextId) ?? null;
        })();
      if (neighbor) focusTile(neighbor.key);
    },
    [focusTile],
  );

  const spinBy = useCallback(
    (dPitch: number, dYaw: number) => {
      const current = poseRef.current;
      markInteraction();
      setHintVisible(false);
      animateTo(
        { pitch: current.pitch + dPitch, yaw: current.yaw + dYaw, dolly: current.dolly },
        null,
        420,
      );
    },
    [animateTo, markInteraction],
  );

  /** Write every tile's transform straight to the DOM. Returns true while hover easing is still settling. */
  const paint = useCallback((dt: number): boolean => {
    const rig = rigRef.current;
    const stage = stageRef.current;
    const list = tilesRef.current;
    const r = radiusRef.current;
    if (!rig || !stage || list.length === 0 || r === 0) return false;

    const { pitch, dolly } = poseRef.current;
    const intro = easeOutCubic(introRef.current);
    const yaw = poseRef.current.yaw - (1 - intro) * INTRO_SPIN;
    const spread = 0.55 + 0.45 * intro;
    const amounts = focusAmountsRef.current;
    const focused = focusedKeyRef.current;
    const hovered = focused === null ? hoveredKeyRef.current : null;
    let dim = 0;
    for (const value of amounts.values()) dim = Math.max(dim, value);

    rig.style.transform = `translateZ(${dolly.toFixed(2)}px)`;
    stage.style.transform = `rotateX(${pitch.toFixed(5)}rad) rotateY(${yaw.toFixed(5)}rad)`;
    const counter = `rotateY(${(-yaw).toFixed(5)}rad) rotateX(${(-pitch).toFixed(5)}rad)`;

    let hoverSettling = false;
    let titleTile: OrbTile | null = null;
    let titleWidth = 0;
    let titlePoint = { x: 0, y: 0, z: 0 };

    for (const tile of list) {
      const el = elementsRef.current.get(tile.key);
      if (!el) continue;

      const point = rotatePoint(tile.x, tile.y, tile.z, pitch, yaw);
      const facing = (point.z / r + 1) / 2;
      const amount = amounts.get(tile.key) ?? 0;

      const hoverTarget = tile.key === hovered ? 1 : 0;
      let hover = hoverAmountsRef.current.get(tile.key) ?? 0;
      if (hover !== hoverTarget) {
        hover += (hoverTarget - hover) * Math.min(1, dt * 14);
        if (Math.abs(hoverTarget - hover) < 0.002) hover = hoverTarget;
        else hoverSettling = true;
        hoverAmountsRef.current.set(tile.key, hover);
      }

      const resting = tile.tileWidth * facingScale(facing) * (1 + HOVER_LIFT * hover);
      const width = lerp(resting, tile.focusWidth, amount);
      const restingOpacity = facingOpacity(facing) * (1 - FOCUS_DIM * (dim - amount));
      const opacity = lerp(restingOpacity, 1, amount) * Math.min(1, intro * 1.25);

      // Lay out at focus size while (un)focusing so the image stays sharp; the
      // transform only ever scales down.
      const layoutWidth = amount > 0 ? tile.focusWidth : tile.tileWidth;
      if (appliedWidthRef.current.get(tile.key) !== layoutWidth) {
        appliedWidthRef.current.set(tile.key, layoutWidth);
        const layoutHeight = layoutWidth / tile.aspect;
        el.style.width = `${layoutWidth}px`;
        el.style.height = `${layoutHeight}px`;
        el.style.marginLeft = `${-layoutWidth / 2}px`;
        el.style.marginTop = `${-layoutHeight / 2}px`;
      }

      el.style.transform = `translate3d(${(tile.x * spread).toFixed(2)}px, ${(tile.y * spread).toFixed(2)}px, ${(tile.z * spread).toFixed(2)}px) ${counter} scale(${(width / layoutWidth).toFixed(4)})`;
      el.style.opacity = opacity.toFixed(3);

      const interactive =
        focused === null
          ? facing >= FACING_POINTER_MIN && intro > 0.85
          : tile.key === focused;
      if (appliedInteractiveRef.current.get(tile.key) !== interactive) {
        appliedInteractiveRef.current.set(tile.key, interactive);
        el.style.pointerEvents = interactive ? "auto" : "none";
        el.tabIndex = interactive ? 0 : -1;
      }

      if (tile.key === focused) {
        titleTile = tile;
        titleWidth = width;
        titlePoint = point;
      }
    }

    const title = titleRef.current;
    if (title) {
      if (titleTile) {
        const { width: vw, height: vh } = viewportSizeRef.current;
        const scale = perspectiveScale(titlePoint.z * spread + dolly);
        const x = vw / 2 + titlePoint.x * spread * scale;
        const y =
          vh / 2 +
          titlePoint.y * spread * scale +
          (titleWidth / titleTile.aspect / 2) * scale +
          22;
        const reveal = Math.min(1, Math.max(0, ((amounts.get(titleTile.key) ?? 0) - 0.6) / 0.4));
        title.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + (1 - reveal) * 8).toFixed(1)}px, 0) translateX(-50%)`;
        title.style.opacity = reveal.toFixed(3);
      } else {
        title.style.opacity = "0";
      }
    }

    return hoverSettling;
  }, []);

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

  // One loop drives intro, tweens, inertia, idle drift, and painting.
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
          pitch: lerp(tween.from.pitch, tween.to.pitch, eased),
          yaw: lerpAngle(tween.from.yaw, tween.to.yaw, eased),
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
        const speed = Math.hypot(velocity.pitch, velocity.yaw);
        let next = pose;
        if (speed > INERTIA_MIN && !reduced) {
          const decay = Math.pow(INERTIA_FRICTION, dt * 60);
          velocity.pitch *= decay;
          velocity.yaw *= decay;
          next = {
            ...next,
            pitch: next.pitch + velocity.pitch * dt,
            yaw: next.yaw + velocity.yaw * dt,
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
              pitch: next.pitch + (IDLE_PITCH - next.pitch) * Math.min(1, dt * 0.5) * ramp,
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
      if (direction === "left") spinBy(0, 0.55);
      else if (direction === "right") spinBy(0, -0.55);
      else if (direction === "up") spinBy(0.32, 0);
      else spinBy(-0.32, 0);
      return;
    }

    if (
      (event.key === "Enter" || event.key === " ") &&
      document.activeElement === viewportRef.current
    ) {
      event.preventDefault();
      const { pitch, yaw } = poseRef.current;
      const tile = frontTile(tilesRef.current, pitch, yaw);
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
        setPose({ ...poseRef.current, yaw: poseRef.current.yaw - event.deltaX * 0.004 });
        return;
      }
      const zoom = event.deltaY * (event.ctrlKey ? 2.4 : 0.6);
      dollyTargetRef.current = clampDolly(dollyTargetRef.current - zoom, radiusRef.current);
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
    // Grabbing the globe catches it mid-spin.
    velocityRef.current = { pitch: 0, yaw: 0 };
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
      dollyTargetRef.current = clampDolly(pinch.dolly + delta * 0.8, radiusRef.current);
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
      // Rubber-band: the globe leans with the finger, then hops or settles.
      setPose({
        pitch: drag.base.pitch - totalY * FOCUS_DRAG_SENSITIVITY,
        yaw: drag.base.yaw + totalX * FOCUS_DRAG_SENSITIVITY,
        dolly: drag.base.dolly,
      });
    } else {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      const seconds = Math.max(0.008, (now - drag.lastT) / 1000);
      const current = poseRef.current;
      const yawDelta = dx * SPIN_SENSITIVITY;
      const pitchDelta = -dy * SPIN_SENSITIVITY;
      const velocity = velocityRef.current;
      velocity.yaw = lerp(velocity.yaw, yawDelta / seconds, 0.6);
      velocity.pitch = lerp(velocity.pitch, pitchDelta / seconds, 0.6);
      setPose({
        pitch: current.pitch + pitchDelta,
        yaw: current.yaw + yawDelta,
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
      velocityRef.current = { pitch: 0, yaw: 0 };
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
  const compact = (viewport?.width ?? 1200) < 640;

  return (
    <>
      <div
        ref={viewportRef}
        className={`canvas-viewport orb-viewport${isSpinning ? " is-panning" : ""}${focusedTile ? " is-focused" : ""}`}
        style={{ perspective: `${ORB_PERSPECTIVE}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={onBackgroundClick}
        tabIndex={0}
        role="application"
        aria-roledescription="3D gallery"
        aria-label="Art orb"
        aria-describedby="orb-instructions"
      >
        <p id="orb-instructions" className="sr-only">
          Arrow keys spin the orb. Enter opens the piece facing you. Tab moves
          between visible pieces. In a piece, arrow keys move to neighbors and
          Escape returns to the orb.
        </p>
        <div ref={rigRef} className="orb-rig">
          <div ref={stageRef} className="orb-stage">
            {tiles.map((tile) => (
              <OrbWork
                key={tile.key}
                tile={tile}
                focused={tile.key === focusedKey}
                register={register}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        ref={titleRef}
        className="orb-title"
        style={{ fontSize: compact ? 18 : 22 }}
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
            ? "Drag to spin · tap a piece"
            : "Drag to spin · scroll to zoom · click a piece"}
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
            aria-label="Back to the orb"
            aria-keyshortcuts="Escape"
            onClick={(event) => {
              event.stopPropagation();
              unfocus();
            }}
          >
            <span aria-hidden="true">← Orb</span>
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
