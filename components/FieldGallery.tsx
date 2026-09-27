"use client";

import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkImage } from "@/components/WorkImage";
import { works } from "@/data/works";
import {
  clamp,
  easeInOutCubic,
  fitRect,
  lerp,
  zoomAt,
  type Camera,
} from "@/lib/camera";
import {
  directionFromDelta,
  findNeighbor,
  type NavDirection,
  type Rect,
} from "@/lib/canvasLayout";
import {
  COLUMN_WIDTH,
  createFieldLayout,
  homePoint,
  itemsInRect,
  nearestPlacement,
  overviewScale,
  workIdOf,
  type FieldItem,
} from "@/lib/fieldLayout";

type Viewport = { width: number; height: number };

type FieldGalleryProps = {
  /** Work id from the URL to open (null = overview). */
  requestedWork: string | null;
  /** Called with the open work's id (or null) whenever focus changes here. */
  onFocusChange: (workId: string | null) => void;
};

const FOCUS_DURATION = 620;
const UNFOCUS_DURATION = 480;
const PAN_FRICTION = 0.92;
/** px/s below which a fling comes to rest. */
const PAN_MIN_SPEED = 12;
const DRAG_THRESHOLD = 5;
const SWIPE_MIN_DISTANCE = 64;
/** Mount pieces this far (in viewports) beyond the edges so they're ready. */
const OVERSCAN = 0.35;
const MAX_ZOOM = 3;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function viewRect(camera: Camera, viewport: Viewport, overscan = 0): Rect {
  const width = viewport.width / camera.scale;
  const height = viewport.height / camera.scale;
  return {
    x: -camera.x / camera.scale - width * overscan,
    y: -camera.y / camera.scale - height * overscan,
    width: width * (1 + overscan * 2),
    height: height * (1 + overscan * 2),
  };
}

function cameraCenteredOn(x: number, y: number, scale: number, viewport: Viewport): Camera {
  return {
    scale,
    x: viewport.width / 2 - x * scale,
    y: viewport.height / 2 - y * scale,
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

type FieldPieceProps = {
  item: FieldItem;
  focused: boolean;
  tileSizes: string;
  onSelect: (id: string) => void;
};

const FieldPiece = memo(function FieldPiece({
  item,
  focused,
  tileSizes,
  onSelect,
}: FieldPieceProps) {
  return (
    <button
      type="button"
      className={`field-item${focused ? " is-focused" : ""}`}
      style={{
        left: item.x,
        top: item.y,
        width: item.displayWidth,
        height: item.displayHeight,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item.id);
      }}
      aria-label={`${item.title}, ${item.year}`}
      aria-pressed={focused}
    >
      <WorkImage
        work={item}
        tileSizes={tileSizes}
        detailSizes="(max-width: 640px) 92vw, 60vw"
        detail={focused}
        loading="eager"
      />
    </button>
  );
});

export function FieldGallery({ requestedWork, onFocusChange }: FieldGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => createFieldLayout(works), []);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [items, setItems] = useState<FieldItem[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const [isPanning, setIsPanning] = useState(false);

  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const viewportSizeRef = useRef<Viewport>({ width: 0, height: 0 });
  const homeScaleRef = useRef(1);
  const itemsKeyRef = useRef("");
  const focusedIdRef = useRef<string | null>(null);
  const focusedItemRef = useRef<FieldItem | null>(null);
  const tweenRef = useRef<number | null>(null);
  const inertiaRef = useRef<number | null>(null);
  const velocityRef = useRef({ x: 0, y: 0 });
  const idleTimerRef = useRef<number | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    moved: boolean;
    start: Camera;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const onFocusChangeRef = useRef(onFocusChange);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  /** Keep the caption pinned under the open piece, in screen space. */
  const placeTitle = useCallback(() => {
    const title = titleRef.current;
    if (!title) return;
    const item = focusedItemRef.current;
    if (!item) {
      title.style.opacity = "0";
      return;
    }
    const cam = cameraRef.current;
    const x = cam.x + (item.x + item.displayWidth / 2) * cam.scale;
    const y = cam.y + (item.y + item.displayHeight) * cam.scale + 14;
    title.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`;
    title.style.opacity = "1";
  }, []);

  /**
   * Move the camera: write the transform straight to the DOM, and only touch
   * React state when the set of nearby pieces actually changes.
   */
  const applyCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next;
      const world = worldRef.current;
      if (world) {
        world.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
        // Composite while moving; drop the hint at rest so Chrome re-rasters
        // the pieces sharply at the new zoom.
        world.style.willChange = "transform";
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(() => {
          if (worldRef.current) worldRef.current.style.willChange = "auto";
        }, 180);
      }
      const size = viewportSizeRef.current;
      if (size.width > 0) {
        const nearby = itemsInRect(layout, viewRect(next, size, OVERSCAN));
        const key = nearby.map((item) => item.id).join("|");
        if (key !== itemsKeyRef.current) {
          itemsKeyRef.current = key;
          setItems(nearby);
        }
      }
      placeTitle();
    },
    [layout, placeTitle],
  );

  const stopMotion = useCallback(() => {
    if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
    if (inertiaRef.current !== null) cancelAnimationFrame(inertiaRef.current);
    tweenRef.current = null;
    inertiaRef.current = null;
    velocityRef.current = { x: 0, y: 0 };
  }, []);

  const animateTo = useCallback(
    (target: Camera, duration: number) => {
      stopMotion();
      const from = cameraRef.current;
      const start = performance.now();
      const ms = prefersReducedMotion() ? 1 : duration;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const e = easeInOutCubic(t);
        applyCamera({
          x: lerp(from.x, target.x, e),
          y: lerp(from.y, target.y, e),
          scale: lerp(from.scale, target.scale, e),
        });
        tweenRef.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      tweenRef.current = requestAnimationFrame(tick);
    },
    [applyCamera, stopMotion],
  );

  const startInertia = useCallback(() => {
    if (prefersReducedMotion()) return;
    let last = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can precede the performance.now() taken above.
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const velocity = velocityRef.current;
      const decay = Math.pow(PAN_FRICTION, dt * 60);
      velocity.x *= decay;
      velocity.y *= decay;
      const cam = cameraRef.current;
      applyCamera({ ...cam, x: cam.x + velocity.x * dt, y: cam.y + velocity.y * dt });
      inertiaRef.current =
        Math.hypot(velocity.x, velocity.y) > PAN_MIN_SPEED ? requestAnimationFrame(tick) : null;
    };
    inertiaRef.current = requestAnimationFrame(tick);
  }, [applyCamera]);

  const setFocus = useCallback(
    (item: FieldItem | null) => {
      focusedIdRef.current = item?.id ?? null;
      focusedItemRef.current = item;
      setFocusedId(item?.id ?? null);
      onFocusChangeRef.current(item ? item.workId : null);
      placeTitle();
    },
    [placeTitle],
  );

  const focusItem = useCallback(
    (item: FieldItem) => {
      const size = viewportSizeRef.current;
      const compact = size.width < 640;
      const target = fitRect(
        { x: item.x, y: item.y, width: item.displayWidth, height: item.displayHeight },
        size.width,
        size.height,
        compact ? 24 : 56,
        compact ? 0.92 : 0.58,
      );
      // Leave room under the piece for its caption.
      target.y -= 18;
      setFocus(item);
      setHintVisible(false);
      animateTo(target, FOCUS_DURATION);
    },
    [animateTo, setFocus],
  );

  const findItem = useCallback(
    (id: string) =>
      itemsInRect(layout, viewRect(cameraRef.current, viewportSizeRef.current, 1.5)).find(
        (item) => item.id === id,
      ) ?? null,
    [layout],
  );

  const unfocus = useCallback(() => {
    if (!focusedIdRef.current) return;
    setFocus(null);
    const size = viewportSizeRef.current;
    const cam = cameraRef.current;
    const centerX = (size.width / 2 - cam.x) / cam.scale;
    const centerY = (size.height / 2 - cam.y) / cam.scale;
    animateTo(cameraCenteredOn(centerX, centerY, homeScaleRef.current, size), UNFOCUS_DURATION);
  }, [animateTo, setFocus]);

  const hop = useCallback(
    (direction: NavDirection) => {
      const id = focusedIdRef.current;
      if (!id) return;
      const current = findItem(id);
      if (!current) return;
      const around = itemsInRect(layout, {
        x: current.x - COLUMN_WIDTH * 3,
        y: current.y - COLUMN_WIDTH * 4,
        width: COLUMN_WIDTH * 7,
        height: COLUMN_WIDTH * 8 + current.displayHeight,
      });
      const next = findNeighbor(around, id, direction);
      if (next) focusItem(next as FieldItem);
    },
    [findItem, focusItem, layout],
  );

  const onSelect = useCallback(
    (id: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (focusedIdRef.current === id) {
        unfocus();
        return;
      }
      const item = findItem(id);
      if (item) focusItem(item);
    },
    [findItem, focusItem, unfocus],
  );

  // Measure first; nothing is rendered until then, so SSR and client agree.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let first = true;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const size = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (size.width < 40 || size.height < 40) return;
      viewportSizeRef.current = size;
      const home = overviewScale(size.width);
      homeScaleRef.current = home;
      setViewport(size);
      if (first) {
        first = false;
        const start = homePoint(size.width);
        applyCamera(cameraCenteredOn(start.x, start.y, home, size));
      } else {
        applyCamera(cameraRef.current);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyCamera]);

  const measured = viewport !== null;

  // The world div mounts after the first measure; paint the camera onto it.
  const attachWorld = useCallback((el: HTMLDivElement | null) => {
    worldRef.current = el;
    if (!el) return;
    const cam = cameraRef.current;
    el.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.scale})`;
  }, []);

  // Follow the URL: open the requested work's nearest placement, or zoom back
  // out when it's cleared (e.g. the Back button).
  const followRequestedWork = useEffectEvent(() => {
    const currentId = focusedIdRef.current;
    const current = currentId ? workIdOf(currentId) : null;
    if (current === requestedWork) return;
    if (!requestedWork) {
      unfocus();
      return;
    }
    const size = viewportSizeRef.current;
    const cam = cameraRef.current;
    const item = nearestPlacement(
      layout,
      requestedWork,
      (size.width / 2 - cam.x) / cam.scale,
      (size.height / 2 - cam.y) / cam.scale,
    );
    if (item) focusItem(item);
  });

  useEffect(() => {
    if (!measured) return;
    // Next frame, so a deep link paints the wall first and then flies in.
    const frame = requestAnimationFrame(() => followRequestedWork());
    return () => cancelAnimationFrame(frame);
  }, [measured, requestedWork]);

  useEffect(() => () => {
    stopMotion();
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
  }, [stopMotion]);

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
    if (direction) {
      event.preventDefault();
      setHintVisible(false);
      if (focusedIdRef.current) {
        hop(direction);
        return;
      }
      const step = 320;
      const cam = cameraRef.current;
      const dx = direction === "left" ? step : direction === "right" ? -step : 0;
      const dy = direction === "up" ? step : direction === "down" ? -step : 0;
      animateTo({ ...cam, x: cam.x + dx, y: cam.y + dy }, 360);
      return;
    }
    if (
      (event.key === "Enter" || event.key === " ") &&
      document.activeElement === viewportRef.current
    ) {
      event.preventDefault();
      const size = viewportSizeRef.current;
      const cam = cameraRef.current;
      const cx = (size.width / 2 - cam.x) / cam.scale;
      const cy = (size.height / 2 - cam.y) / cam.scale;
      const nearest = itemsInRect(layout, viewRect(cam, size))
        .map((item) => ({
          item,
          d: Math.hypot(item.x + item.displayWidth / 2 - cx, item.y + item.displayHeight / 2 - cy),
        }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearest) focusItem(nearest.item);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Trackpad scroll pans (like Cosmos); pinch / ctrl-scroll zooms at the cursor.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setHintVisible(false);
      stopMotion();
      const cam = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.01);
        const scale = clamp(cam.scale * factor, homeScaleRef.current * 0.45, MAX_ZOOM);
        const next = zoomAt(cam, event.clientX - rect.left, event.clientY - rect.top, scale);
        if (focusedIdRef.current && scale < cam.scale) setFocus(null);
        applyCamera(next);
        return;
      }
      // Wandering off an open piece closes it (the camera stays put).
      if (focusedIdRef.current) setFocus(null);
      const lines = event.deltaMode === 1 ? 16 : 1;
      applyCamera({ ...cam, x: cam.x - event.deltaX * lines, y: cam.y - event.deltaY * lines });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [applyCamera, setFocus, stopMotion]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stopMotion();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchRef.current = {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        scale: cameraRef.current.scale,
      };
      dragRef.current = null;
      suppressClickRef.current = true;
      return;
    }
    if (pointers.size > 2) return;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: false,
      start: { ...cameraRef.current },
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
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = clamp(
        pinch.scale * (distance / pinch.distance),
        homeScaleRef.current * 0.45,
        MAX_ZOOM,
      );
      if (focusedIdRef.current && scale < cameraRef.current.scale * 0.9) setFocus(null);
      applyCamera(
        zoomAt(cameraRef.current, (a!.x + b!.x) / 2 - rect.left, (a!.y + b!.y) / 2 - rect.top, scale),
      );
      setHintVisible(false);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const totalX = event.clientX - drag.startX;
    const totalY = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(totalX, totalY) <= DRAG_THRESHOLD) return;
      drag.moved = true;
      suppressClickRef.current = true;
      // Capture only once it's a drag, so plain taps still click pieces.
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
      setHintVisible(false);
    }
    const now = performance.now();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    const seconds = Math.max(0.008, (now - drag.lastT) / 1000);
    const velocity = velocityRef.current;
    velocity.x = lerp(velocity.x, dx / seconds, 0.6);
    velocity.y = lerp(velocity.y, dy / seconds, 0.6);
    const cam = cameraRef.current;
    // With a piece open the wall leans with the finger, then hops or settles.
    const resistance = focusedIdRef.current ? 0.45 : 1;
    applyCamera({ ...cam, x: cam.x + dx * resistance, y: cam.y + dy * resistance });
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
    setIsPanning(false);
    if (!drag.moved) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const focused = focusedIdRef.current;
    if (focused) {
      const direction = directionFromDelta(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        SWIPE_MIN_DISTANCE,
      );
      if (direction) {
        hop(direction);
      } else {
        const item = findItem(focused);
        if (item) focusItem(item);
      }
      return;
    }
    if (performance.now() - drag.lastT > 90) return; // paused before release
    startInertia();
  };

  const onBackgroundClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    unfocus();
  };

  const tileSizes = viewport
    ? `${Math.ceil(COLUMN_WIDTH * overviewScale(viewport.width) * 1.25)}px`
    : "240px";
  const focusedItem = focusedId ? items.find((item) => item.id === focusedId) ?? null : null;
  const focusedWork = focusedId ? works.find((work) => work.id === workIdOf(focusedId)) ?? null : null;
  const catalogIndex = focusedWork ? works.indexOf(focusedWork) : -1;
  const compact = (viewport?.width ?? 1200) < 640;

  return (
    <>
      <div
        ref={viewportRef}
        className={`canvas-viewport field-viewport${isPanning ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={onBackgroundClick}
        tabIndex={0}
        role="application"
        aria-roledescription="infinite canvas"
        aria-label="Art field"
        aria-describedby="field-instructions"
      >
        <p id="field-instructions" className="sr-only">
          Drag or scroll to wander. Arrow keys move around; Enter opens the
          piece in the middle. In a piece, arrow keys move to neighbors and
          Escape returns to the field.
        </p>
        {viewport ? (
          <div
            ref={attachWorld}
            className={`field-world${focusedId ? " is-focus-mode" : ""}`}
          >
            {items.map((item) => (
              <FieldPiece
                key={item.id}
                item={item}
                focused={item.id === focusedId}
                tileSizes={tileSizes}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={titleRef}
        className="orb-title"
        style={{ fontSize: compact ? 14 : 15 }}
        aria-hidden="true"
      >
        {focusedWork && focusedItem ? (
          <>
            <span className="canvas-work-name-title">{focusedWork.title}</span>
            <span className="canvas-work-name-year">{focusedWork.year}</span>
          </>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">
        {focusedWork
          ? `${focusedWork.title}, ${focusedWork.year}. ${catalogIndex + 1} of ${works.length}.`
          : ""}
      </p>

      {hintVisible && !focusedWork ? (
        <p className="canvas-hint">
          {compact ? "Drag to wander · tap a piece" : "Drag or scroll to wander · click a piece"}
        </p>
      ) : null}

      {focusedWork ? (
        <>
          <div
            className={`canvas-caption${focusedWork.note ? "" : " canvas-caption-meta-only"}`}
          >
            {focusedWork.note ? (
              <p className="canvas-caption-note">{focusedWork.note}</p>
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
            aria-label="Back to the field"
            aria-keyshortcuts="Escape"
            onClick={(event) => {
              event.stopPropagation();
              unfocus();
            }}
          >
            <span aria-hidden="true">← Field</span>
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
