"use client";

import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { LensViewer } from "@/components/LensViewer";
import { WorkImage } from "@/components/WorkImage";
import { works, type Work } from "@/data/works";
import { lerp } from "@/lib/camera";
import {
  LENS_MAGNIFICATION,
  lensMetrics,
  warpTile,
  workAt,
  type LensMetrics,
} from "@/lib/lensLayout";

type LensGalleryProps = {
  /** Work id from the URL to open (null = grid). */
  requestedWork: string | null;
  /** Called with the open work's id (or null) whenever it changes here. */
  onFocusChange: (workId: string | null) => void;
};

type Viewport = { width: number; height: number };
type Point = { x: number; y: number };
type Lens = { x: number; y: number; power: number };
type Cell = { key: string; col: number; row: number; work: Work };
type Open = { workId: string; fromTile: boolean };

/** How quickly the lens chases its target (per second, exponential). */
const LENS_FOLLOW = 13;
const PAN_FOLLOW = 10;
const PAN_FRICTION = 0.92;
const PAN_MIN_SPEED = 12;
const DRAG_THRESHOLD = 5;
/** Extra rings of tiles mounted past the edges. */
const OVERSCAN_CELLS = 1;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

type LensTileProps = {
  cell: Cell;
  size: number;
  active: boolean;
  tileSizes: string;
  register: (key: string, el: HTMLButtonElement | null) => void;
  onSelect: (key: string) => void;
  onFocusTile: (key: string, el: HTMLButtonElement) => void;
};

/**
 * One grid tile. LensGallery writes its transform every frame straight to
 * the DOM, so React only renders it when it mounts or becomes active.
 */
const LensTile = memo(function LensTile({
  cell,
  size,
  active,
  tileSizes,
  register,
  onSelect,
  onFocusTile,
}: LensTileProps) {
  return (
    <button
      ref={(el) => {
        register(cell.key, el);
        return () => register(cell.key, null);
      }}
      type="button"
      className="lens-tile"
      style={{ width: size, height: size }}
      tabIndex={active ? 0 : -1}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(cell.key);
      }}
      onFocus={(event) => onFocusTile(cell.key, event.currentTarget)}
      aria-label={`${cell.work.title}, ${cell.work.year}`}
    >
      <WorkImage
        work={cell.work}
        tileSizes={tileSizes}
        detailSizes={tileSizes}
        detail={false}
        loading="eager"
      />
    </button>
  );
});

export function LensGallery({ requestedWork, onFocusChange }: LensGalleryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [activeKey, setActiveKey] = useState(cellKey(0, 0));
  const [open, setOpen] = useState<Open | null>(null);
  const [closing, setClosing] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [isPanning, setIsPanning] = useState(false);

  const metricsRef = useRef<LensMetrics>(lensMetrics(1200, 800));
  const sizeRef = useRef<Viewport>({ width: 0, height: 0 });
  /** Screen position of cell (0, 0)'s center. */
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const panTargetRef = useRef<Point | null>(null);
  const lensRef = useRef<Lens>({ x: 0, y: 0, power: 0 });
  const lensTargetRef = useRef<Lens>({ x: 0, y: 0, power: 1 });
  const velocityRef = useRef<Point>({ x: 0, y: 0 });
  const coastingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const tilesRef = useRef(new Map<string, HTMLButtonElement>());
  const writtenRef = useRef(new Map<HTMLButtonElement, string>());
  const cellsKeyRef = useRef("");
  const labelKeyRef = useRef("");
  const touchRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const openRef = useRef<Open | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  /** Hand focus back to the grid once the closed piece's dialog is gone. */
  const restoreFocusRef = useRef(false);
  const onFocusChangeRef = useRef(onFocusChange);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const cellCenter = useCallback((col: number, row: number): Point => {
    const { pitch } = metricsRef.current;
    const pan = panRef.current;
    return { x: pan.x + col * pitch, y: pan.y + row * pitch };
  }, []);

  /** Where the lens rests when nothing is steering it. */
  const restPoint = useCallback((): Point => {
    const size = sizeRef.current;
    return { x: size.width / 2, y: size.height / 2 };
  }, []);

  /** Mount exactly the tiles on screen (plus a ring), in stable order. */
  const syncCells = useCallback(() => {
    const size = sizeRef.current;
    const { pitch } = metricsRef.current;
    const pan = panRef.current;
    const minCol = Math.floor(-pan.x / pitch) - OVERSCAN_CELLS;
    const maxCol = Math.ceil((size.width - pan.x) / pitch) + OVERSCAN_CELLS;
    const minRow = Math.floor(-pan.y / pitch) - OVERSCAN_CELLS;
    const maxRow = Math.ceil((size.height - pan.y) / pitch) + OVERSCAN_CELLS;
    const key = `${minCol},${maxCol},${minRow},${maxRow}`;
    if (key === cellsKeyRef.current) return;
    cellsKeyRef.current = key;
    const next: Cell[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        next.push({ key: cellKey(col, row), col, row, work: workAt(works, col, row) });
      }
    }
    setCells(next);
  }, []);

  /** Warp every mounted tile around the lens, and pin the label under the biggest. */
  const paint = useCallback(() => {
    const { tile, radius } = metricsRef.current;
    const lens = lensRef.current;
    const written = writtenRef.current;
    let top: { key: string; x: number; y: number; scale: number } | null = null;

    for (const [key, el] of tilesRef.current) {
      const [col, row] = key.split(":").map(Number) as [number, number];
      const center = cellCenter(col, row);
      const dx = center.x - lens.x;
      const dy = center.y - lens.y;
      const warp = warpTile(dx, dy, tile, radius, lens.power);
      const x = lens.x + warp.x;
      const y = lens.y + warp.y;
      const transform = `translate3d(${(x - tile / 2).toFixed(2)}px, ${(y - tile / 2).toFixed(2)}px, 0) scale(${warp.scale.toFixed(4)})`;
      if (written.get(el) !== transform) {
        written.set(el, transform);
        el.style.transform = transform;
        el.style.zIndex = String(Math.round(warp.scale * 100));
      }
      if (!top || warp.scale > top.scale) top = { key, x, y, scale: warp.scale };
    }

    const label = labelRef.current;
    if (label) {
      const showLabel = top && lens.power > 0.6 && top.scale > 1.6 && !openRef.current;
      if (showLabel && top) {
        if (labelKeyRef.current !== top.key) {
          labelKeyRef.current = top.key;
          const [col, row] = top.key.split(":").map(Number) as [number, number];
          const work = workAt(works, col, row);
          const [title, year] = label.children as unknown as [HTMLElement, HTMLElement];
          title.textContent = work.title;
          year.textContent = String(work.year);
        }
        const y = top.y + (tile * top.scale) / 2 + 14;
        label.style.transform = `translate3d(${top.x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`;
        label.style.opacity = "1";
      } else {
        label.style.opacity = "0";
      }
    }

    const glass = glassRef.current;
    if (glass) {
      glass.style.transform = `translate3d(${(lens.x - radius).toFixed(1)}px, ${(lens.y - radius).toFixed(1)}px, 0)`;
      glass.style.opacity = String(Math.max(0, Math.min(1, lens.power)));
    }
  }, [cellCenter]);

  /** Settle the grid so a tile sits squarely under the lens. */
  const snapUnderLens = useCallback(() => {
    const { pitch } = metricsRef.current;
    const lens = lensTargetRef.current;
    const pan = panRef.current;
    const col = Math.round((lens.x - pan.x) / pitch);
    const row = Math.round((lens.y - pan.y) / pitch);
    panTargetRef.current = { x: lens.x - col * pitch, y: lens.y - row * pitch };
  }, []);

  /** Advance one frame; true while anything is still moving. */
  const step = useCallback(
    (now: number): boolean => {
      const dt = Math.min(0.05, Math.max(0, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      const instant = prefersReducedMotion();
      let moving = false;

      const lens = lensRef.current;
      const target = lensTargetRef.current;
      const follow = instant ? 1 : 1 - Math.exp(-LENS_FOLLOW * dt);
      lens.x = lerp(lens.x, target.x, follow);
      lens.y = lerp(lens.y, target.y, follow);
      lens.power = lerp(lens.power, target.power, instant ? 1 : 1 - Math.exp(-7 * dt));
      if (
        Math.abs(lens.x - target.x) > 0.1 ||
        Math.abs(lens.y - target.y) > 0.1 ||
        Math.abs(lens.power - target.power) > 0.002
      ) {
        moving = true;
      } else {
        lens.x = target.x;
        lens.y = target.y;
        lens.power = target.power;
      }

      const pan = panRef.current;
      const panTarget = panTargetRef.current;
      if (panTarget) {
        const k = instant ? 1 : 1 - Math.exp(-PAN_FOLLOW * dt);
        pan.x = lerp(pan.x, panTarget.x, k);
        pan.y = lerp(pan.y, panTarget.y, k);
        if (Math.abs(pan.x - panTarget.x) < 0.2 && Math.abs(pan.y - panTarget.y) < 0.2) {
          pan.x = panTarget.x;
          pan.y = panTarget.y;
          panTargetRef.current = null;
        } else {
          moving = true;
        }
      } else if (coastingRef.current) {
        const velocity = velocityRef.current;
        const decay = Math.pow(PAN_FRICTION, dt * 60);
        velocity.x *= decay;
        velocity.y *= decay;
        pan.x += velocity.x * dt;
        pan.y += velocity.y * dt;
        if (Math.hypot(velocity.x, velocity.y) > PAN_MIN_SPEED) {
          moving = true;
        } else {
          coastingRef.current = false;
          // On touch the lens stays put, so settle a tile squarely under it.
          if (touchRef.current) snapUnderLens();
          moving = panTargetRef.current !== null;
        }
      }

      syncCells();
      paint();
      return moving;
    },
    [paint, snapUnderLens, syncCells],
  );

  const kick = useCallback(() => {
    if (frameRef.current !== null) return;
    lastFrameRef.current = performance.now();
    const tick = (now: number) => {
      frameRef.current = step(now) ? requestAnimationFrame(tick) : null;
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [step]);

  const register = useCallback(
    (key: string, el: HTMLButtonElement | null) => {
      if (el) {
        tilesRef.current.set(key, el);
        // Place new tiles before they paint, so they never flash at 0,0.
        kick();
      } else {
        const old = tilesRef.current.get(key);
        if (old) writtenRef.current.delete(old);
        tilesRef.current.delete(key);
      }
    },
    [kick],
  );

  // Paint freshly mounted tiles in the same commit they appear.
  useEffect(() => {
    paint();
  }, [cells, paint]);

  const openWork = useCallback((workId: string, fromTile: boolean) => {
    setClosing(false);
    setOpen({ workId, fromTile });
    setHintVisible(false);
    onFocusChangeRef.current(workId);
  }, []);

  const onSelect = useCallback(
    (key: string) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const [col, row] = key.split(":").map(Number) as [number, number];
      setActiveKey(key);
      // Center the lens on the chosen tile so it flies out of its biggest self.
      const center = cellCenter(col, row);
      lensTargetRef.current = { x: center.x, y: center.y, power: 1 };
      kick();
      openWork(workAt(works, col, row).id, true);
    },
    [cellCenter, kick, openWork],
  );

  const onFocusTile = useCallback(
    (key: string, el: HTMLButtonElement) => {
      setActiveKey(key);
      if (!el.matches(":focus-visible")) return;
      const [col, row] = key.split(":").map(Number) as [number, number];
      // Aim where the tile is headed if the grid is still gliding to it.
      const { pitch } = metricsRef.current;
      const pan = panTargetRef.current ?? panRef.current;
      lensTargetRef.current = { x: pan.x + col * pitch, y: pan.y + row * pitch, power: 1 };
      kick();
    },
    [kick],
  );

  /** Rect of the open work's copy nearest the lens, for the flight in and out. */
  const originFor = useCallback(
    (workId: string): DOMRect | null => {
      const lens = lensTargetRef.current;
      let best: { el: HTMLButtonElement; d: number } | null = null;
      for (const [key, el] of tilesRef.current) {
        const [col, row] = key.split(":").map(Number) as [number, number];
        if (workAt(works, col, row).id !== workId) continue;
        const center = cellCenter(col, row);
        const d = Math.hypot(center.x - lens.x, center.y - lens.y);
        if (!best || d < best.d) best = { el, d };
      }
      if (!best) return null;
      const rect = best.el.getBoundingClientRect();
      const size = sizeRef.current;
      const onScreen =
        rect.right > 0 && rect.bottom > 0 && rect.left < size.width && rect.top < size.height;
      return onScreen ? rect : null;
    },
    [cellCenter],
  );

  const requestClose = useCallback(() => {
    if (!openRef.current) return;
    setClosing(true);
  }, []);

  const onClosed = useCallback(() => {
    setOpen(null);
    setClosing(false);
    onFocusChangeRef.current(null);
    restoreFocusRef.current = true;
  }, []);

  const onStep = useCallback(
    (delta: number) => {
      const current = openRef.current;
      if (!current) return;
      const index = works.findIndex((work) => work.id === current.workId);
      const next = works[(index + delta + works.length) % works.length]!;
      setClosing(false);
      setOpen({ workId: next.id, fromTile: false });
      onFocusChangeRef.current(next.id);
    },
    [],
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
      const previous = sizeRef.current;
      sizeRef.current = size;
      metricsRef.current = lensMetrics(size.width, size.height);
      const rest = restPoint();
      if (first) {
        first = false;
        panRef.current = { ...rest };
        lensRef.current = { x: rest.x, y: rest.y, power: 0 };
        lensTargetRef.current = { x: rest.x, y: rest.y, power: 1 };
      } else {
        // Keep the same tile in the middle across resizes.
        panRef.current = {
          x: panRef.current.x + (size.width - previous.width) / 2,
          y: panRef.current.y + (size.height - previous.height) / 2,
        };
        if (!pointerInsideRef.current) lensTargetRef.current = { ...rest, power: 1 };
      }
      cellsKeyRef.current = "";
      writtenRef.current.clear();
      setViewport(size);
      syncCells();
      kick();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [kick, restPoint, syncCells]);

  const measured = viewport !== null;

  // Follow the URL: open the requested work, or close when it's cleared.
  const followRequestedWork = useEffectEvent(() => {
    const current = openRef.current?.workId ?? null;
    if (current === requestedWork) return;
    if (!requestedWork) {
      requestClose();
      return;
    }
    setClosing(false);
    setOpen({ workId: requestedWork, fromTile: current === null });
    setHintVisible(false);
  });

  useEffect(() => {
    if (!measured) return;
    // Next frame, so a deep link paints the grid first.
    const frameId = requestAnimationFrame(() => followRequestedWork());
    return () => cancelAnimationFrame(frameId);
  }, [measured, requestedWork]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // Trackpad scroll pans; the lens stays where the cursor is.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) return;
      setHintVisible(false);
      coastingRef.current = false;
      panTargetRef.current = null;
      const lines = event.deltaMode === 1 ? 16 : 1;
      panRef.current = {
        x: panRef.current.x - event.deltaX * lines,
        y: panRef.current.y - event.deltaY * lines,
      };
      kick();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [kick]);

  const aimLens = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    lensTargetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      power: 1,
    };
    kick();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    touchRef.current = event.pointerType !== "mouse";
    if (dragRef.current) return;
    coastingRef.current = false;
    panTargetRef.current = null;
    velocityRef.current = { x: 0, y: 0 };
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: performance.now(),
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      pointerInsideRef.current = true;
      aimLens(event);
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD) {
        return;
      }
      drag.moved = true;
      suppressClickRef.current = true;
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
    panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastT = now;
    kick();
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const paused = performance.now() - drag.lastT > 90;
    if (!paused && !prefersReducedMotion()) {
      coastingRef.current = true;
    } else if (touchRef.current) {
      snapUnderLens();
    }
    kick();
  };

  const onPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || dragRef.current) return;
    pointerInsideRef.current = false;
    // Drift home to the middle rather than vanish.
    lensTargetRef.current = { ...restPoint(), power: 1 };
    kick();
  };

  // Arrow keys walk the grid; the lens rides along and the grid follows.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (openRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
    const steps: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    setHintVisible(false);
    const [col, row] = activeKey.split(":").map(Number) as [number, number];
    const nextCol = col + step[0];
    const nextRow = row + step[1];
    const { pitch } = metricsRef.current;
    const rest = restPoint();
    // Center the new tile, and park the lens on it.
    panTargetRef.current = { x: rest.x - nextCol * pitch, y: rest.y - nextRow * pitch };
    lensTargetRef.current = { ...rest, power: 1 };
    setActiveKey(cellKey(nextCol, nextRow));
    kick();
  };

  // Keep keyboard focus on the active tile once it has mounted.
  useEffect(() => {
    const root = viewportRef.current;
    if (!root || !root.contains(document.activeElement)) return;
    const el = tilesRef.current.get(activeKey);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [activeKey, cells]);

  // If the roving tile scrolls away, hand the tab stop to the tile under the lens.
  const tabKey = cells.some((cell) => cell.key === activeKey)
    ? activeKey
    : (cells[Math.floor(cells.length / 2)]?.key ?? activeKey);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    tilesRef.current.get(tabKey)?.focus({ preventScroll: true });
  }, [open, tabKey]);

  const metrics = viewport ? lensMetrics(viewport.width, viewport.height) : null;
  const tileSizes = metrics ? `${Math.ceil(metrics.tile * LENS_MAGNIFICATION)}px` : "300px";
  const openIndex = open ? works.findIndex((work) => work.id === open.workId) : -1;
  const openWorkItem = openIndex >= 0 ? works[openIndex]! : null;
  const compact = (viewport?.width ?? 1200) < 640;

  const glassStyle = metrics
    ? { width: metrics.radius * 2, height: metrics.radius * 2 }
    : undefined;

  return (
    <>
      <div
        ref={viewportRef}
        className={`canvas-viewport lens-viewport${isPanning ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        role="application"
        aria-roledescription="fish-eye grid"
        aria-label="Art lens"
        aria-describedby="lens-instructions"
        aria-hidden={open ? true : undefined}
        inert={open ? true : undefined}
      >
        <p id="lens-instructions" className="sr-only">
          Every piece in a grid under a magnifying lens. Drag or scroll to
          wander. Arrow keys move between pieces; Enter opens one. In a piece,
          arrow keys step through the catalog and Escape returns to the grid.
        </p>
        {metrics ? (
          <div className="lens-world">
            <div ref={glassRef} className="lens-glass" style={glassStyle} aria-hidden="true" />
            {cells.map((cell) => (
              <LensTile
                key={cell.key}
                cell={cell}
                size={metrics.tile}
                active={cell.key === tabKey}
                tileSizes={tileSizes}
                register={register}
                onSelect={onSelect}
                onFocusTile={onFocusTile}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={labelRef}
        className="orb-title lens-label"
        style={{ fontSize: compact ? 13 : 14 }}
        aria-hidden="true"
      >
        <span className="canvas-work-name-title" />
        <span className="canvas-work-name-year" />
      </div>

      {hintVisible && !open ? (
        <p className="canvas-hint">
          {compact ? "Drag the grid under the lens · tap a piece" : "Move to look closer · drag to wander"}
        </p>
      ) : null}

      {openWorkItem ? (
        <LensViewer
          work={openWorkItem}
          index={openIndex}
          total={works.length}
          tileSizes={tileSizes}
          originFor={originFor}
          fromTile={open?.fromTile ?? false}
          closing={closing}
          onClose={requestClose}
          onClosed={onClosed}
          onStep={onStep}
        />
      ) : null}
    </>
  );
}
