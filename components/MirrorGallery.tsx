"use client";

import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { WorkImage } from "@/components/WorkImage";
import { works, type Work } from "@/data/works";
import { lerp } from "@/lib/camera";
import {
  drawWalls,
  mirrorMetrics,
  mod,
  slidePose,
  slideSize,
  wrappedOffset,
  type MirrorMetrics,
  type WallLayer,
} from "@/lib/mirrorLayout";

type MirrorGalleryProps = {
  /** Work id from the URL to show in the middle (null = keep the current one). */
  requestedWork: string | null;
  /** Called with the middle work's id once the row settles after the viewer moves it. */
  onFocusChange: (workId: string | null) => void;
};

type Viewport = { width: number; height: number };

type SlideParts = { root: HTMLDivElement };

const SETTLE_SPEED = 9;
const DRAG_THRESHOLD = 5;
const WHEEL_SETTLE_MS = 140;
/** Slides mounted on either side of the middle one. */
const REACH = 3;
/** How many times the walls fold the piece at rest. */
const BASE_DEPTH = 1.6;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Longest edge of the copy the walls sample from; they're soft anyway. */
const WALL_SOURCE_SIZE = 320;

/**
 * A small copy of `source` for the walls to sample. Hundreds of strips a
 * frame from a full-size image is slow; from this it's nearly free. Video
 * copies refresh every call; stills are cached per piece and quality.
 */
function wallSource(
  cache: Map<string, HTMLCanvasElement>,
  key: string,
  source: CanvasImageSource,
  width: number,
  height: number,
  live: boolean,
): HTMLCanvasElement | null {
  let copy = cache.get(key);
  if (copy && !live) return copy;
  const scale = Math.min(1, WALL_SOURCE_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (!copy) {
    copy = document.createElement("canvas");
    cache.set(key, copy);
  }
  if (copy.width !== w) copy.width = w;
  if (copy.height !== h) copy.height = h;
  const ctx = copy.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return copy;
}

/** The sharpest thing on screen for this piece: the detail layer once loaded, else the tile. */
function reflectionSource(
  root: HTMLElement,
): { source: CanvasImageSource; width: number; height: number; live: boolean; tag: string } | null {
  const detail = root.querySelector<HTMLImageElement | HTMLVideoElement>(
    ".canvas-work-image-detail.is-loaded",
  );
  if (detail instanceof HTMLVideoElement && detail.readyState >= 2) {
    return {
      source: detail,
      width: detail.videoWidth,
      height: detail.videoHeight,
      live: !detail.paused,
      tag: "video",
    };
  }
  if (detail instanceof HTMLImageElement && detail.complete && detail.naturalWidth > 0) {
    return { source: detail, width: detail.naturalWidth, height: detail.naturalHeight, live: false, tag: "detail" };
  }
  const tile = root.querySelector<HTMLImageElement>("img.canvas-work-image");
  if (tile && tile.complete && tile.naturalWidth > 0) {
    return { source: tile, width: tile.naturalWidth, height: tile.naturalHeight, live: false, tag: "tile" };
  }
  return null;
}

type MirrorSlideProps = {
  work: Work;
  index: number;
  metrics: MirrorMetrics;
  centered: boolean;
  detail: boolean;
  tileSizes: string;
  register: (index: number, parts: SlideParts | null) => void;
  onSelect: (index: number) => void;
};

/**
 * One piece in the row. MirrorGallery writes its position, scale and
 * opacity every frame, so React only renders it when its role changes.
 */
const MirrorSlide = memo(function MirrorSlide({
  work,
  index,
  metrics,
  centered,
  detail,
  tileSizes,
  register,
  onSelect,
}: MirrorSlideProps) {
  const { width, height } = slideSize(metrics, work.width, work.height);

  return (
    <div
      ref={(root) => {
        if (!root) return;
        register(index, { root });
        return () => register(index, null);
      }}
      className="mirror-slide"
      style={{ width, height }}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${works.length}: ${work.title}, ${work.year}`}
      aria-hidden={centered ? undefined : true}
    >
      <button
        type="button"
        className="mirror-piece"
        tabIndex={-1}
        aria-label={centered ? `${work.title}, ${work.year}` : `Show ${work.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(index);
        }}
      >
        <WorkImage
          work={work}
          tileSizes={tileSizes}
          detailSizes="(max-width: 640px) 70vw, 45vw"
          detail={detail}
          loading="eager"
        />
      </button>
    </div>
  );
});

export function MirrorGallery({ requestedWork, onFocusChange }: MirrorGalleryProps) {
  const count = works.length;
  const stageRef = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [center, setCenter] = useState(() => {
    const index = works.findIndex((work) => work.id === requestedWork);
    return index >= 0 ? index : 0;
  });
  const [settled, setSettled] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);

  const metricsRef = useRef<MirrorMetrics>(mirrorMetrics(1200, 800));
  const sizeRef = useRef<Viewport>({ width: 0, height: 0 });
  const pixelRatioRef = useRef(1);
  const wallsRef = useRef<HTMLCanvasElement>(null);
  /** Parameters the walls were last painted with, to skip identical frames. */
  const wallsKeyRef = useRef("");
  const wallSourcesRef = useRef(new Map<string, HTMLCanvasElement>());
  /** Continuous position along the row, in slides (unbounded; wrapped for display). */
  const posRef = useRef(center);
  const targetRef = useRef<number | null>(null);
  const velocityRef = useRef(0);
  const smoothVelocityRef = useRef(0);
  const phaseRef = useRef(0);
  const biasRef = useRef(0);
  const biasTargetRef = useRef(0);
  const wheelTimerRef = useRef<number | null>(null);
  const wheelActiveRef = useRef(false);
  const slidesRef = useRef(new Map<number, SlideParts>());
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const centerRef = useRef(center);
  const settledRef = useRef(true);
  const movedByViewerRef = useRef(false);
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startPos: number;
    lastX: number;
    lastT: number;
    moved: boolean;
  } | null>(null);
  const onFocusChangeRef = useRef(onFocusChange);

  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  /** Place every mounted slide and repaint the walls. */
  const paint = useCallback((): { pending: boolean; live: boolean } => {
    const size = sizeRef.current;
    const metrics = metricsRef.current;
    const pos = posRef.current;

    for (const [index, parts] of slidesRef.current) {
      const work = works[index]!;
      const offset = wrappedOffset(index, pos, count);
      const pose = slidePose(offset, metrics);
      const { width, height } = slideSize(metrics, work.width, work.height);
      const x = size.width / 2 + pose.x - width / 2;
      const y = metrics.centerY - height / 2;
      parts.root.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${pose.scale.toFixed(4)})`;
      // Pieces live inside the room: they dissolve as they near a side wall.
      const centerX = size.width / 2 + pose.x;
      const clearance = Math.min(centerX, size.width - centerX) - metrics.wallX;
      const reach = (width * pose.scale) / 2 + metrics.wallX * 0.5;
      const inRoom = Math.max(0, Math.min(1, clearance / reach));
      parts.root.style.opacity = (pose.opacity * inRoom * inRoom * (3 - 2 * inRoom)).toFixed(3);
      parts.root.style.zIndex = String(100 - Math.round(Math.abs(offset) * 10));
    }

    const canvas = wallsRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || size.width === 0) return { pending: false, live: false };

    // The walls reflect the piece in the middle; between two, both crossfade.
    const base = Math.floor(pos);
    const blend = pos - base;
    const layers: WallLayer[] = [];
    const tags: string[] = [];
    let pending = false;
    let live = false;
    for (const [slot, alpha] of [
      [0, 1],
      [1, blend],
    ] as const) {
      if (alpha <= 0.004) continue;
      const index = mod(base + slot, count);
      const root = slidesRef.current.get(index)?.root;
      const found = root ? reflectionSource(root) : null;
      if (!found) {
        pending = true;
        continue;
      }
      live ||= found.live;
      const tag = `${index}:${found.tag}`;
      const copy = wallSource(
        wallSourcesRef.current,
        tag,
        found.source,
        found.width,
        found.height,
        found.live,
      );
      if (!copy) continue;
      tags.push(tag);
      layers.push({
        source: copy,
        width: copy.width,
        height: copy.height,
        alpha,
        offset: blend - slot,
      });
    }

    const velocity = smoothVelocityRef.current;
    const ripple = Math.min(1, Math.abs(velocity) * 0.7);
    // Sliding pushes the walls: deeper folds all round, leaning into the
    // direction of travel; the cursor leans them the same way.
    const refraction = {
      depth: Math.min(3.4, BASE_DEPTH + Math.abs(velocity) * 0.5),
      lean: Math.max(-1, Math.min(1, velocity * 0.3 + biasRef.current * 0.45)),
      ripple,
      phase: phaseRef.current,
    };
    const key = [
      tags.join(","),
      pos.toFixed(4),
      refraction.depth.toFixed(3),
      refraction.lean.toFixed(3),
      ripple > 0 ? `${ripple.toFixed(3)}|${refraction.phase.toFixed(2)}` : "0",
      canvas.width,
      canvas.height,
    ].join("|");
    if (live || key !== wallsKeyRef.current) {
      wallsKeyRef.current = key;
      drawWalls(
        ctx,
        layers,
        size.width,
        size.height,
        metrics.wallX,
        metrics.wallY,
        pixelRatioRef.current,
        refraction,
      );
    }
    return { pending, live };
  }, [count]);

  const settle = useCallback(() => {
    if (!movedByViewerRef.current) return;
    movedByViewerRef.current = false;
    onFocusChangeRef.current(works[mod(Math.round(posRef.current), count)]!.id);
  }, [count]);

  /** Advance one frame; true while anything still needs frames. */
  const step = useCallback(
    (now: number): boolean => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;
      const instant = prefersReducedMotion();

      const target = targetRef.current;
      if (!dragRef.current?.moved && target !== null) {
        const before = posRef.current;
        const k = instant ? 1 : 1 - Math.exp(-SETTLE_SPEED * dt);
        posRef.current = lerp(before, target, k);
        velocityRef.current = (posRef.current - before) / dt;
        if (Math.abs(target - posRef.current) < 0.0008) {
          posRef.current = target;
          targetRef.current = null;
          velocityRef.current = 0;
          settle();
        }
      } else if (!dragRef.current?.moved && !wheelActiveRef.current) {
        velocityRef.current = 0;
      }

      const follow = instant ? 1 : 1 - Math.exp(-8 * dt);
      smoothVelocityRef.current = instant ? 0 : lerp(smoothVelocityRef.current, velocityRef.current, follow);
      if (Math.abs(smoothVelocityRef.current) < 0.002) smoothVelocityRef.current = 0;
      biasRef.current = instant ? biasTargetRef.current : lerp(biasRef.current, biasTargetRef.current, 1 - Math.exp(-5 * dt));
      if (Math.abs(biasRef.current - biasTargetRef.current) < 0.002) biasRef.current = biasTargetRef.current;
      phaseRef.current += dt * (2 + Math.abs(smoothVelocityRef.current) * 6);

      const { pending, live } = paint();

      const nextCenter = mod(Math.round(posRef.current), count);
      if (nextCenter !== centerRef.current) {
        centerRef.current = nextCenter;
        setCenter(nextCenter);
      }
      const moving =
        Boolean(dragRef.current?.moved) ||
        wheelActiveRef.current ||
        targetRef.current !== null ||
        smoothVelocityRef.current !== 0 ||
        biasRef.current !== biasTargetRef.current;
      if (settledRef.current === moving) {
        settledRef.current = !moving;
        setSettled(!moving);
      }
      return moving || pending || live;
    },
    [count, paint, settle],
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
    (index: number, parts: SlideParts | null) => {
      if (parts) slidesRef.current.set(index, parts);
      else slidesRef.current.delete(index);
      kick();
    },
    [kick],
  );

  /** Glide to slide `index` the short way round. */
  const goTo = useCallback(
    (index: number, byViewer = true) => {
      const pos = posRef.current;
      targetRef.current = Math.round(pos + wrappedOffset(index, pos, count));
      if (byViewer) {
        movedByViewerRef.current = true;
        setHintVisible(false);
      }
      kick();
    },
    [count, kick],
  );

  const stepBy = useCallback(
    (delta: number) => {
      const base = targetRef.current ?? Math.round(posRef.current);
      targetRef.current = base + delta;
      movedByViewerRef.current = true;
      setHintVisible(false);
      kick();
    },
    [kick],
  );

  const onSelect = useCallback(
    (index: number) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (index !== centerRef.current) goTo(index);
    },
    [goTo],
  );

  // Measure first; nothing is rendered until then, so SSR and client agree.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const size = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (size.width < 40 || size.height < 40) return;
      sizeRef.current = size;
      metricsRef.current = mirrorMetrics(size.width, size.height);
      // Walls are painted at half resolution: upscaling softens them like a
      // blur would, without a full-screen filter pass every frame.
      const ratio = 0.5;
      pixelRatioRef.current = ratio;
      const canvas = wallsRef.current;
      if (canvas) {
        canvas.width = Math.round(size.width * ratio);
        canvas.height = Math.round(size.height * ratio);
      }
      wallsKeyRef.current = "";
      setViewport(size);
      kick();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [kick]);

  // Media finishing loading or starting to play needs the mirrors repainted
  // (and kept painting, for video). These events don't bubble, so capture.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wake = () => kick();
    el.addEventListener("load", wake, true);
    el.addEventListener("playing", wake, true);
    return () => {
      el.removeEventListener("load", wake, true);
      el.removeEventListener("playing", wake, true);
    };
  }, [kick]);

  // Follow the URL (deep links, Back / Forward): bring that piece to the middle.
  const followRequestedWork = useEffectEvent(() => {
    if (!requestedWork) return;
    const index = works.findIndex((work) => work.id === requestedWork);
    if (index < 0) return;
    const heading = targetRef.current ?? Math.round(posRef.current);
    if (mod(heading, count) === index) return;
    goTo(index, false);
  });

  useEffect(() => {
    followRequestedWork();
  }, [requestedWork]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    },
    [],
  );

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepBy(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepBy(-1);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Trackpad swipes and the wheel slide the row; it snaps once they stop.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const lines = event.deltaMode === 1 ? 16 : 1;
      const slides = (delta * lines) / (metricsRef.current.dragPerSlide * 1.4);
      targetRef.current = null;
      posRef.current += slides;
      velocityRef.current = lerp(velocityRef.current, slides * 60, 0.5);
      wheelActiveRef.current = true;
      movedByViewerRef.current = true;
      setHintVisible(false);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => {
        wheelActiveRef.current = false;
        targetRef.current = Math.round(posRef.current);
        kick();
      }, WHEEL_SETTLE_MS);
      kick();
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [kick]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragRef.current) return;
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPos: posRef.current,
      lastX: event.clientX,
      lastT: performance.now(),
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      const size = sizeRef.current;
      biasTargetRef.current = Math.max(-1, Math.min(1, (event.clientX - size.width / 2) / (size.width / 2)));
      kick();
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.startX) <= DRAG_THRESHOLD) return;
      drag.moved = true;
      suppressClickRef.current = true;
      targetRef.current = null;
      drag.startPos = posRef.current;
      drag.startX = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
      movedByViewerRef.current = true;
      setIsDragging(true);
      setHintVisible(false);
    }
    const now = performance.now();
    const perSlide = metricsRef.current.dragPerSlide;
    const before = posRef.current;
    posRef.current = drag.startPos - (event.clientX - drag.startX) / perSlide;
    const seconds = Math.max(0.008, (now - drag.lastT) / 1000);
    velocityRef.current = lerp(velocityRef.current, (posRef.current - before) / seconds, 0.6);
    drag.lastX = event.clientX;
    drag.lastT = now;
    kick();
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A flick carries on a little; a pause before letting go doesn't.
    const flick = performance.now() - drag.lastT > 90 ? 0 : velocityRef.current * 0.22;
    const pos = posRef.current;
    const projected = pos + Math.max(-4, Math.min(4, flick));
    targetRef.current = Math.round(projected);
    kick();
  };

  const onPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    biasTargetRef.current = 0;
    kick();
  };

  const metrics = viewport ? mirrorMetrics(viewport.width, viewport.height) : null;
  const tileSizes = metrics ? `${Math.ceil(metrics.maxWidth)}px` : "600px";
  const mounted =
    count <= REACH * 2 + 1
      ? works.map((_, index) => index)
      : Array.from({ length: REACH * 2 + 1 }, (_, i) => mod(center - REACH + i, count));
  const work = works[center]!;

  return (
    <>
      <div
        ref={stageRef}
        className={`canvas-viewport mirror-stage${isDragging ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={onPointerLeave}
        role="region"
        aria-roledescription="carousel"
        aria-label="Art mirror"
        style={
          metrics
            ? ({
                "--wall-x": `${metrics.wallX}px`,
                "--wall-y": `${metrics.wallY}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <canvas ref={wallsRef} className="mirror-walls" aria-hidden="true" />
        <div className="mirror-row">
        {metrics
          ? mounted.map((index) => (
              <MirrorSlide
                key={index}
                work={works[index]!}
                index={index}
                metrics={metrics}
                centered={index === center}
                detail={index === center && settled}
                tileSizes={tileSizes}
                register={register}
                onSelect={onSelect}
              />
            ))
          : null}
        </div>
      </div>

      {metrics ? (
        <div className="mirror-caption" key={work.id} aria-hidden="true">
          <span className="canvas-work-name-title">{work.title}</span>
          <span className="canvas-work-name-year">{work.year}</span>
        </div>
      ) : null}

      <div className="mirror-controls">
        {work.note ? <p className="canvas-caption-note mirror-note">{work.note}</p> : null}
        <div className="mirror-scrub">
          <button
            type="button"
            className="mirror-step"
            onClick={() => stepBy(-1)}
            aria-label="Previous work"
          >
            ‹
          </button>
          <input
            type="range"
            className="mirror-range"
            min={0}
            max={count - 1}
            step={1}
            value={center}
            onChange={(event) => goTo(Number(event.currentTarget.value))}
            aria-label="Choose a work"
            aria-valuetext={`${work.title}, ${center + 1} of ${count}`}
            style={{ "--progress": `${(center / Math.max(1, count - 1)) * 100}%` } as React.CSSProperties}
          />
          <button
            type="button"
            className="mirror-step"
            onClick={() => stepBy(1)}
            aria-label="Next work"
          >
            ›
          </button>
          <span className="canvas-caption-index mirror-index">
            {String(center + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
          </span>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {`${work.title}, ${work.year}. ${center + 1} of ${count}.`}
      </p>

      {hintVisible ? (
        <p className="canvas-hint mirror-hint">
          {metrics?.compact ? "Swipe to slide" : "Drag, scroll or use ← → to slide"}
        </p>
      ) : null}
    </>
  );
}
