"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { works } from "@/data/works";
import { CanvasWork } from "@/components/CanvasWork";
import {
  cameraTransform,
  clampCamera,
  easeInOutCubic,
  fitRect,
  lerpCamera,
  panBy,
  zoomAt,
  type Camera,
} from "@/lib/camera";
import {
  boundsOf,
  directionFromDelta,
  findMagneticWork,
  findNeighbor,
  layoutWorks,
  rectOf,
  type NavDirection,
  type PlacedWork,
} from "@/lib/canvasLayout";
import {
  applyDrag,
  boundsFromWorld,
  createWorld,
  isWorldAwake,
  releaseBody,
  stepWorld,
  type PhysicsWorld,
} from "@/lib/physics";

type Mode = "overview" | "focused";

const FOCUS_PADDING = 48;
const FOCUS_SCALE = 0.5;
const OVERVIEW_PADDING = 80;
const MAGNET_SNAP_RATIO = 0.62;
const SWIPE_MIN_DISTANCE = 56;

type Pose = { x: number; y: number; angle: number };

export function CanvasGallery() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const placed = useMemo(() => layoutWorks(works), []);
  const initialBounds = useMemo(() => boundsOf(placed), [placed]);

  const worldRef = useRef<PhysicsWorld | null>(null);
  if (worldRef.current === null) {
    worldRef.current = createWorld(placed);
  }

  const [poses, setPoses] = useState<Record<string, Pose>>(() => {
    const initial: Record<string, Pose> = {};
    for (const work of placed) {
      initial[work.id] = { x: work.x, y: work.y, angle: 0 };
    }
    return initial;
  });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [mode, setMode] = useState<Mode>("overview");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  const cameraRef = useRef(camera);
  const modeRef = useRef(mode);
  const focusedIdRef = useRef(focusedId);
  const tweenRef = useRef<number | null>(null);
  const physicsRafRef = useRef<number | null>(null);
  const lastPhysicsTimeRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const pieceDragRef = useRef<{
    id: string;
    pointerId: number;
    grabOffsetX: number;
    grabOffsetY: number;
    lastWorldX: number;
    lastWorldY: number;
    lastT: number;
    samples: Array<{ t: number; x: number; y: number }>;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const didInitFit = useRef(false);
  const skipClickRef = useRef(false);
  const wheelNavAt = useRef(0);
  const magnetLockRef = useRef(false);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);

  const livePlaced: PlacedWork[] = useMemo(() => {
    return placed.map((work) => {
      const pose = poses[work.id];
      if (!pose) return work;
      return { ...work, x: pose.x, y: pose.y };
    });
  }, [placed, poses]);

  const worldBounds = useMemo(() => boundsOf(livePlaced), [livePlaced]);

  const focusedWork: PlacedWork | null = useMemo(() => {
    if (!focusedId) return null;
    return livePlaced.find((work) => work.id === focusedId) ?? null;
  }, [focusedId, livePlaced]);

  const focusedIndex = useMemo(() => {
    if (!focusedId) return -1;
    return livePlaced.findIndex((work) => work.id === focusedId);
  }, [focusedId, livePlaced]);

  const publishPoses = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next: Record<string, Pose> = {};
    for (const body of world.bodies) {
      next[body.id] = { x: body.x, y: body.y, angle: body.angle };
    }
    setPoses(next);
  }, []);

  const stopPhysicsLoop = useCallback(() => {
    if (physicsRafRef.current !== null) {
      cancelAnimationFrame(physicsRafRef.current);
      physicsRafRef.current = null;
    }
    lastPhysicsTimeRef.current = null;
  }, []);

  const ensurePhysicsLoop = useCallback(() => {
    if (physicsRafRef.current !== null) return;

    const tick = (now: number) => {
      const world = worldRef.current;
      if (!world) {
        physicsRafRef.current = null;
        return;
      }

      const last = lastPhysicsTimeRef.current ?? now;
      lastPhysicsTimeRef.current = now;
      let dt = (now - last) / 1000;
      dt = Math.min(0.033, Math.max(0, dt));

      const grabbedId = pieceDragRef.current?.id ?? null;
      const awake = stepWorld(world, dt, grabbedId);
      publishPoses();

      if (awake || isWorldAwake(world, grabbedId)) {
        physicsRafRef.current = requestAnimationFrame(tick);
      } else {
        physicsRafRef.current = null;
        lastPhysicsTimeRef.current = null;
      }
    };

    physicsRafRef.current = requestAnimationFrame(tick);
  }, [publishPoses]);

  const stopTween = useCallback(() => {
    if (tweenRef.current !== null) {
      cancelAnimationFrame(tweenRef.current);
      tweenRef.current = null;
    }
  }, []);

  const animateTo = useCallback(
    (target: Camera, duration = 520) => {
      stopTween();
      const from = cameraRef.current;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const next = lerpCamera(from, target, easeInOutCubic(t));
        cameraRef.current = next;
        setCamera(next);
        if (t < 1) {
          tweenRef.current = requestAnimationFrame(tick);
        } else {
          tweenRef.current = null;
        }
      };

      tweenRef.current = requestAnimationFrame(tick);
    },
    [stopTween],
  );

  const applyCamera = useCallback((next: Camera) => {
    const clamped = clampCamera(next);
    cameraRef.current = clamped;
    setCamera(clamped);
  }, []);

  const workById = useCallback(
    (id: string): PlacedWork | null => {
      const base = placed.find((item) => item.id === id);
      if (!base) return null;
      const body = worldRef.current?.byId.get(id);
      if (!body) return base;
      return { ...base, x: body.x, y: body.y };
    },
    [placed],
  );

  const fitAll = useCallback(() => {
    const { width, height } = viewport;
    if (width < 10 || height < 10) return;
    const bounds = worldRef.current
      ? boundsFromWorld(worldRef.current)
      : worldBounds;
    const target = fitRect(bounds, width, height, OVERVIEW_PADDING);
    magnetLockRef.current = false;
    setMode("overview");
    setFocusedId(null);
    animateTo(target);
  }, [animateTo, viewport, worldBounds]);

  const focusWork = useCallback(
    (id: string) => {
      const work = workById(id);
      if (!work) return;
      const { width, height } = viewport;
      const target = fitRect(
        rectOf(work),
        width,
        height,
        FOCUS_PADDING,
        FOCUS_SCALE,
      );
      setMode("focused");
      setFocusedId(id);
      setHintVisible(false);
      animateTo(target, 560);
    },
    [animateTo, viewport, workById],
  );

  const focusRelative = useCallback(
    (delta: number) => {
      if (livePlaced.length === 0) return;
      const current = focusedIdRef.current;
      const currentIndex = current
        ? livePlaced.findIndex((work) => work.id === current)
        : 0;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (base + delta + livePlaced.length) % livePlaced.length;
      const next = livePlaced[nextIndex];
      if (next) focusWork(next.id);
    },
    [focusWork, livePlaced],
  );

  const focusInDirection = useCallback(
    (direction: NavDirection) => {
      const current = focusedIdRef.current;
      if (!current) return;
      const neighbor = findNeighbor(livePlaced, current, direction);
      if (neighbor) {
        focusWork(neighbor.id);
        return;
      }
      focusRelative(direction === "left" || direction === "up" ? -1 : 1);
    },
    [focusRelative, focusWork, livePlaced],
  );

  const maybeExitFocusFromZoom = useCallback(
    (nextScale: number) => {
      if (modeRef.current !== "focused") return;
      const id = focusedIdRef.current;
      const work = id ? workById(id) : null;
      if (!work) return;
      const { width, height } = viewport;
      const focusedFit = fitRect(
        rectOf(work),
        width,
        height,
        FOCUS_PADDING,
        FOCUS_SCALE,
      );
      if (nextScale < focusedFit.scale * 0.55) {
        magnetLockRef.current = false;
        setMode("overview");
        setFocusedId(null);
      }
    },
    [viewport, workById],
  );

  const maybeMagneticSnap = useCallback(
    (next: Camera, screenX: number, screenY: number, zoomingIn: boolean) => {
      if (!zoomingIn) return;
      if (modeRef.current === "focused") return;
      if (magnetLockRef.current) return;

      const worldX = (screenX - next.x) / next.scale;
      const worldY = (screenY - next.y) / next.scale;
      const { width, height } = viewport;

      const target = findMagneticWork(
        livePlaced,
        worldX,
        worldY,
        next.scale,
        (work) =>
          fitRect(rectOf(work), width, height, FOCUS_PADDING, FOCUS_SCALE)
            .scale,
        MAGNET_SNAP_RATIO,
      );

      if (!target) return;
      magnetLockRef.current = true;
      focusWork(target.id);
    },
    [focusWork, livePlaced, viewport],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      setViewport({ width, height });

      if (!didInitFit.current && width >= 40 && height >= 40) {
        didInitFit.current = true;
        const target = fitRect(initialBounds, width, height, OVERVIEW_PADDING);
        cameraRef.current = target;
        setCamera(target);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [initialBounds]);

  const onKeyNavigate = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      fitAll();
      return;
    }
    if (modeRef.current !== "focused") return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusInDirection("right");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusInDirection("left");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusInDirection("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusInDirection("up");
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => onKeyNavigate(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(
    () => () => {
      stopTween();
      stopPhysicsLoop();
    },
    [stopPhysicsLoop, stopTween],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      stopTween();

      const rect = el.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;

      if (modeRef.current === "focused") {
        const absX = Math.abs(event.deltaX);
        const absY = Math.abs(event.deltaY);
        const isSwipe =
          Math.max(absX, absY) > 12 &&
          (absX > absY * 1.1 || (absY > absX * 1.1 && absY > 28));

        if (isSwipe && absX >= absY) {
          const now = performance.now();
          if (now - wheelNavAt.current < 420) return;
          wheelNavAt.current = now;
          focusInDirection(event.deltaX > 0 ? "right" : "left");
          return;
        }

        if (isSwipe && absY > absX && Math.abs(event.deltaY) > 40) {
          const now = performance.now();
          if (now - wheelNavAt.current < 420) return;
          wheelNavAt.current = now;
          focusInDirection(event.deltaY > 0 ? "down" : "up");
          return;
        }
      }

      const prevScale = cameraRef.current.scale;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = zoomAt(
        cameraRef.current,
        sx,
        sy,
        cameraRef.current.scale * factor,
      );
      applyCamera(next);
      maybeExitFocusFromZoom(next.scale);
      maybeMagneticSnap(next, sx, sy, next.scale > prevScale);
      setHintVisible(false);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [
    applyCamera,
    focusInDirection,
    maybeExitFocusFromZoom,
    maybeMagneticSnap,
    stopTween,
  ]);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      x: (clientX - rect.left - cam.x) / cam.scale,
      y: (clientY - rect.top - cam.y) / cam.scale,
    };
  }, []);

  const onGrabWork = (
    id: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    if (modeRef.current === "focused") return;

    event.stopPropagation();
    stopTween();

    const world = worldRef.current;
    const body = world?.byId.get(id);
    if (!body || !world) return;

    const point = screenToWorld(event.clientX, event.clientY);
    body.vx = 0;
    body.vy = 0;
    body.omega *= 0.2;

    pieceDragRef.current = {
      id,
      pointerId: event.pointerId,
      grabOffsetX: point.x - body.x,
      grabOffsetY: point.y - body.y,
      lastWorldX: point.x,
      lastWorldY: point.y,
      lastT: performance.now(),
      samples: [{ t: performance.now(), x: point.x, y: point.y }],
      moved: false,
    };
    dragRef.current = null;
    setDraggingId(id);
    setHintVisible(false);
    viewportRef.current?.setPointerCapture(event.pointerId);
    ensurePhysicsLoop();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (pieceDragRef.current) return;
    stopTween();
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pieceDrag = pieceDragRef.current;
    if (pieceDrag && pieceDrag.pointerId === event.pointerId) {
      const world = worldRef.current;
      const body = world?.byId.get(pieceDrag.id);
      if (!body) return;

      const now = performance.now();
      const point = screenToWorld(event.clientX, event.clientY);
      const dt = Math.max(0.001, (now - pieceDrag.lastT) / 1000);

      if (
        !pieceDrag.moved &&
        Math.hypot(point.x - (body.x + pieceDrag.grabOffsetX), point.y - (body.y + pieceDrag.grabOffsetY)) >
          2 / cameraRef.current.scale
      ) {
        pieceDrag.moved = true;
        skipClickRef.current = true;
      }

      applyDrag(
        body,
        point.x,
        point.y,
        pieceDrag.grabOffsetX,
        pieceDrag.grabOffsetY,
        dt,
        pieceDrag.lastWorldX,
        pieceDrag.lastWorldY,
      );

      pieceDrag.samples.push({ t: now, x: point.x, y: point.y });
      if (pieceDrag.samples.length > 6) pieceDrag.samples.shift();
      pieceDrag.lastWorldX = point.x;
      pieceDrag.lastWorldY = point.y;
      pieceDrag.lastT = now;
      publishPoses();
      ensurePhysicsLoop();
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      drag.moved = true;
      skipClickRef.current = true;
      setIsPanning(true);
      setHintVisible(false);
    }
    if (drag.moved) {
      if (modeRef.current === "focused") {
        applyCamera(panBy(cameraRef.current, dx * 0.35, dy * 0.35));
      } else {
        applyCamera(panBy(cameraRef.current, dx, dy));
      }
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const pieceDrag = pieceDragRef.current;
    if (pieceDrag && pieceDrag.pointerId === event.pointerId) {
      const world = worldRef.current;
      const body = world?.byId.get(pieceDrag.id);
      if (body) {
        const point = screenToWorld(event.clientX, event.clientY);
        pieceDrag.samples.push({
          t: performance.now(),
          x: point.x,
          y: point.y,
        });
        releaseBody(body, pieceDrag.samples);
      }
      pieceDragRef.current = null;
      setDraggingId(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      ensurePhysicsLoop();
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    if (modeRef.current === "focused" && drag.moved) {
      const totalDx = event.clientX - drag.startX;
      const totalDy = event.clientY - drag.startY;
      const direction = directionFromDelta(
        totalDx,
        totalDy,
        SWIPE_MIN_DISTANCE,
      );
      if (direction) {
        focusInDirection(direction);
        return;
      }
      const id = focusedIdRef.current;
      if (id) focusWork(id);
    }
  };

  const consumeSkipClick = () => {
    if (!skipClickRef.current) return false;
    skipClickRef.current = false;
    return true;
  };

  const onBackgroundClick = () => {
    if (consumeSkipClick()) return;
    if (modeRef.current === "focused") fitAll();
  };

  const onSelectWork = (id: string) => {
    if (consumeSkipClick()) return;
    focusWork(id);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".canvas-work")) return;
    fitAll();
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b) return;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { distance, scale: cameraRef.current.scale };
      dragRef.current = null;
      pieceDragRef.current = null;
      setDraggingId(null);
      setIsPanning(false);
    }
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b) return;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2 - rect.left;
      const midY = (a.clientY + b.clientY) / 2 - rect.top;
      const prevScale = cameraRef.current.scale;
      const nextScale =
        pinchRef.current.scale * (distance / (pinchRef.current.distance || 1));
      const next = zoomAt(cameraRef.current, midX, midY, nextScale);
      applyCamera(next);
      maybeExitFocusFromZoom(next.scale);
      maybeMagneticSnap(next, midX, midY, next.scale > prevScale);
      setHintVisible(false);
    }
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) pinchRef.current = null;
  };

  return (
    <div className="canvas-shell">
      <header className="canvas-header">
        <a
          href="https://www.litt.design"
          className="canvas-logo"
          aria-label="litt.design home"
        >
          <Image
            src="/logo.png"
            alt="litt."
            width={723}
            height={814}
            className="h-10 w-auto object-contain sm:h-11"
            priority
          />
        </a>
        <p className="canvas-header-label">Art</p>
      </header>

      <div
        ref={viewportRef}
        className={`canvas-viewport${isPanning ? " is-panning" : ""}${draggingId ? " is-dragging-piece" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onBackgroundClick}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="application"
        aria-label="Art canvas"
      >
        <div
          className="canvas-world"
          style={{ transform: cameraTransform(camera) }}
        >
          {livePlaced.map((work) => {
            const pose = poses[work.id] ?? { x: work.x, y: work.y, angle: 0 };
            return (
              <CanvasWork
                key={work.id}
                work={work}
                x={pose.x}
                y={pose.y}
                angle={pose.angle}
                focused={work.id === focusedId}
                dragging={work.id === draggingId}
                onSelect={onSelectWork}
                onGrab={onGrabWork}
              />
            );
          })}
        </div>
      </div>

      {hintVisible ? (
        <p className="canvas-hint">
          Drag a piece to toss it · empty space to pan · zoom to snap
        </p>
      ) : null}

      {focusedWork ? (
        <div className="canvas-caption">
          <div>
            <h2 className="canvas-caption-title">{focusedWork.title}</h2>
            {focusedWork.note ? (
              <p className="canvas-caption-note">{focusedWork.note}</p>
            ) : null}
          </div>
          <div className="canvas-caption-meta">
            <span>{focusedWork.year}</span>
            <span className="canvas-caption-index">
              {focusedIndex + 1} / {livePlaced.length}
            </span>
          </div>
        </div>
      ) : null}

      {mode === "focused" ? (
        <div className="canvas-focus-nav">
          <button
            type="button"
            className="canvas-nav-btn"
            onClick={(event) => {
              event.stopPropagation();
              focusInDirection("left");
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
              focusInDirection("right");
            }}
            aria-label="Next work"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
