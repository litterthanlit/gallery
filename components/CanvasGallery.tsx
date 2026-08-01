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
import { works, type Work } from "@/data/works";
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
  directionFromDelta,
  findMagneticWork,
  findNeighbor,
  rectOf,
  type NavDirection,
  type PlacedWork,
} from "@/lib/canvasLayout";
import {
  catalogIndex,
  createTileTemplate,
  gatherVisibleInstances,
  instancesForChunk,
  parseInstanceId,
  type MapInstance,
} from "@/lib/infiniteMap";
import {
  applyDrag,
  createEmptyWorld,
  isWorldAwake,
  releaseBody,
  stepWorld,
  syncWorldToInstances,
  type PhysicsWorld,
} from "@/lib/physics";

type Mode = "overview" | "focused";

const FOCUS_PADDING = 48;
const FOCUS_SCALE = 0.5;
const OVERVIEW_PADDING = 80;
const MAGNET_SNAP_RATIO = 0.9;
const EXIT_FOCUS_RATIO = 0.48;
const MAGNET_COOLDOWN_MS = 550;
const SWIPE_MIN_DISTANCE = 56;

type Pose = { x: number; y: number; angle: number };

function resolveInstance(
  id: string,
  catalog: Work[],
  chunkSize: number,
): MapInstance | null {
  const parsed = parseInstanceId(id);
  if (!parsed) return null;
  return (
    instancesForChunk(
      parsed.chunkX,
      parsed.chunkY,
      catalog,
      chunkSize,
    ).find((item) => item.id === id) ?? null
  );
}

export function CanvasGallery() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const tile = useMemo(() => createTileTemplate(works), []);

  const worldRef = useRef<PhysicsWorld | null>(null);
  if (worldRef.current === null) {
    worldRef.current = createEmptyWorld();
  }
  const poseMemoryRef = useRef<Map<string, Pose>>(new Map());

  const [poses, setPoses] = useState<Record<string, Pose>>({});
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
  const magnetCooldownUntil = useRef(0);
  const focusScaleRef = useRef(1);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);

  const streamed = useMemo(
    () =>
      gatherVisibleInstances(
        camera,
        viewport.width,
        viewport.height,
        tile.catalog,
        tile.chunkSize,
      ),
    [camera, tile.catalog, tile.chunkSize, viewport.height, viewport.width],
  );

  const activeInstances = useMemo(() => {
    const byId = new Map<string, MapInstance>();
    for (const item of streamed) byId.set(item.id, item);

    const ensure = (id: string | null) => {
      if (!id || byId.has(id)) return;
      const found = resolveInstance(id, tile.catalog, tile.chunkSize);
      if (found) byId.set(found.id, found);
    };
    ensure(focusedId);
    ensure(draggingId);

    return [...byId.values()];
  }, [draggingId, focusedId, streamed, tile.catalog, tile.chunkSize]);

  const livePlaced: PlacedWork[] = useMemo(() => {
    return activeInstances.map((work) => {
      const pose = poses[work.id];
      if (!pose) return work;
      return { ...work, x: pose.x, y: pose.y };
    });
  }, [activeInstances, poses]);

  const focusedWork: PlacedWork | null = useMemo(() => {
    if (!focusedId) return null;
    return livePlaced.find((work) => work.id === focusedId) ?? null;
  }, [focusedId, livePlaced]);

  const focusedCatalogIndex = useMemo(() => {
    if (!focusedId) return -1;
    const parsed = parseInstanceId(focusedId);
    if (!parsed) return -1;
    return catalogIndex(parsed.workId);
  }, [focusedId]);

  const publishPoses = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next: Record<string, Pose> = {};
    for (const body of world.bodies) {
      const pose = { x: body.x, y: body.y, angle: body.angle };
      next[body.id] = pose;
      poseMemoryRef.current.set(body.id, pose);
    }
    setPoses(next);
  }, []);

  const syncPhysics = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const keep = new Set<string>();
    if (focusedIdRef.current) keep.add(focusedIdRef.current);
    if (pieceDragRef.current) keep.add(pieceDragRef.current.id);
    syncWorldToInstances(
      world,
      activeInstances,
      poseMemoryRef.current,
      keep,
    );
    publishPoses();
  }, [activeInstances, publishPoses]);

  useEffect(() => {
    syncPhysics();
  }, [syncPhysics]);

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
      // Cap dt so a tab-switch hitch doesn't launch pieces across the map.
      let dt = (now - last) / 1000;
      dt = Math.min(0.024, Math.max(0, dt));

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
      const body = worldRef.current?.byId.get(id);
      const base =
        activeInstances.find((item) => item.id === id) ??
        resolveInstance(id, tile.catalog, tile.chunkSize);
      if (!base) return null;
      if (!body) return base;
      return { ...base, x: body.x, y: body.y };
    },
    [activeInstances, tile.catalog, tile.chunkSize],
  );

  const fitAll = useCallback(() => {
    const { width, height } = viewport;
    if (width < 10 || height < 10) return;
    const target = fitRect(tile.homeBounds, width, height, OVERVIEW_PADDING);
    magnetCooldownUntil.current = performance.now() + MAGNET_COOLDOWN_MS;
    setMode("overview");
    setFocusedId(null);
    animateTo(target);
  }, [animateTo, tile.homeBounds, viewport]);

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
      focusScaleRef.current = target.scale;
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
      if (nextScale < focusedFit.scale * EXIT_FOCUS_RATIO) {
        magnetCooldownUntil.current = performance.now() + MAGNET_COOLDOWN_MS;
        setMode("overview");
        setFocusedId(null);
      }
    },
    [viewport, workById],
  );

  const focusScaleForWork = useCallback(
    (work: PlacedWork) =>
      fitRect(
        rectOf(work),
        viewport.width,
        viewport.height,
        FOCUS_PADDING,
        FOCUS_SCALE,
      ).scale,
    [viewport.height, viewport.width],
  );

  const maybeMagneticSnap = useCallback(
    (next: Camera, screenX: number, screenY: number, zoomingIn: boolean) => {
      if (!zoomingIn) return false;
      if (modeRef.current === "focused") return false;
      if (performance.now() < magnetCooldownUntil.current) return false;

      const worldX = (screenX - next.x) / next.scale;
      const worldY = (screenY - next.y) / next.scale;

      const target = findMagneticWork(
        livePlaced,
        worldX,
        worldY,
        next.scale,
        focusScaleForWork,
        MAGNET_SNAP_RATIO,
      );

      if (!target) return false;
      focusWork(target.id);
      return true;
    },
    [focusScaleForWork, focusWork, livePlaced],
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
        const target = fitRect(
          tile.homeBounds,
          width,
          height,
          OVERVIEW_PADDING,
        );
        cameraRef.current = target;
        setCamera(target);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [tile.homeBounds]);

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

      const rect = el.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;

      if (modeRef.current === "focused") {
        const absX = Math.abs(event.deltaX);
        const absY = Math.abs(event.deltaY);

        if (absX > absY && absX > 12) {
          stopTween();
          const now = performance.now();
          if (now - wheelNavAt.current < 420) return;
          wheelNavAt.current = now;
          focusInDirection(event.deltaX > 0 ? "right" : "left");
          return;
        }

        stopTween();
        const prevScale = cameraRef.current.scale;
        const factor = Math.exp(-event.deltaY * 0.0015);
        let nextScale = prevScale * factor;
        const cap = focusScaleRef.current;
        if (nextScale > cap) nextScale = cap;
        if (Math.abs(nextScale - prevScale) < 0.0001) return;

        const next = zoomAt(cameraRef.current, sx, sy, nextScale);
        applyCamera(next);
        maybeExitFocusFromZoom(next.scale);
        setHintVisible(false);
        return;
      }

      stopTween();
      const prevScale = cameraRef.current.scale;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = zoomAt(
        cameraRef.current,
        sx,
        sy,
        cameraRef.current.scale * factor,
      );

      if (maybeMagneticSnap(next, sx, sy, next.scale > prevScale)) {
        setHintVisible(false);
        return;
      }

      applyCamera(next);
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
        Math.hypot(
          point.x - (body.x + pieceDrag.grabOffsetX),
          point.y - (body.y + pieceDrag.grabOffsetY),
        ) >
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
      // Keep ~120ms of history for a stable toss velocity.
      while (
        pieceDrag.samples.length > 2 &&
        now - pieceDrag.samples[0]!.t > 120
      ) {
        pieceDrag.samples.shift();
      }
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
      const id = pieceDrag.id;
      const wasClick = !pieceDrag.moved;

      if (body) {
        if (wasClick) {
          // Tap — settle the piece and zoom in (viewport capture eats the button click).
          body.vx = 0;
          body.vy = 0;
          body.omega = 0;
        } else {
          const point = screenToWorld(event.clientX, event.clientY);
          pieceDrag.samples.push({
            t: performance.now(),
            x: point.x,
            y: point.y,
          });
          releaseBody(body, pieceDrag.samples);
        }
      }

      pieceDragRef.current = null;
      setDraggingId(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      ensurePhysicsLoop();

      if (wasClick) {
        skipClickRef.current = true;
        focusWork(id);
      }
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
      let nextScale =
        pinchRef.current.scale * (distance / (pinchRef.current.distance || 1));

      if (modeRef.current === "focused" && nextScale > focusScaleRef.current) {
        nextScale = focusScaleRef.current;
      }

      const next = zoomAt(cameraRef.current, midX, midY, nextScale);

      if (
        modeRef.current !== "focused" &&
        maybeMagneticSnap(next, midX, midY, next.scale > prevScale)
      ) {
        setHintVisible(false);
        return;
      }

      applyCamera(next);
      maybeExitFocusFromZoom(next.scale);
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
          Wander endlessly · drag a piece to toss it · zoom to snap
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
              {focusedCatalogIndex >= 0 ? focusedCatalogIndex + 1 : "—"} /{" "}
              {works.length}
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
