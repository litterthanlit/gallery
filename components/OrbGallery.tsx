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
import {
  directionFromDelta,
  type NavDirection,
} from "@/lib/canvasLayout";
import {
  clampPitch,
  FACING_POINTER_MIN,
  facingOpacity,
  facingScale,
  findOrbNeighbor,
  lerpAngle,
  orbRadius,
  placeOnSphere,
  projectToScreen,
  rotatedDepth,
  rotationToFront,
  type OrbWork as OrbWorkData,
} from "@/lib/orbLayout";

type Mode = "overview" | "focused";
type OrbPose = { pitch: number; yaw: number; dolly: number };

const IDLE_PITCH = 0.16;
const IDLE_YAW = 0.45;
const DEFAULT_DOLLY = 0;
const FOCUS_DOLLY = 72;
const FOCUS_DURATION = 560;
const INERTIA_FRICTION = 0.94;
const INERTIA_MIN = 0.00035;
const SPIN_SENSITIVITY = 0.0052;
const SWIPE_MIN_DISTANCE = 56;
const EXIT_FOCUS_DOLLY = -48;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function dollyRange(radius: number): { min: number; max: number } {
  return { min: -radius * 1.15, max: radius * 0.42 };
}

function clampDolly(value: number, radius: number): number {
  const { min, max } = dollyRange(radius);
  return Math.min(max, Math.max(min, value));
}

function workIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("[data-work-id]");
  return el?.getAttribute("data-work-id") ?? null;
}

export function OrbGallery() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [pose, setPose] = useState<OrbPose>({
    pitch: IDLE_PITCH,
    yaw: IDLE_YAW,
    dolly: DEFAULT_DOLLY,
  });
  const [mode, setMode] = useState<Mode>("overview");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);

  const poseRef = useRef(pose);
  const modeRef = useRef(mode);
  const focusedIdRef = useRef(focusedId);
  const tweenRef = useRef<number | null>(null);
  const inertiaRafRef = useRef<number | null>(null);
  const lastInertiaTimeRef = useRef<number | null>(null);
  const velocityRef = useRef({ pitch: 0, yaw: 0 });
  const skipClickRef = useRef(false);
  const wheelNavAt = useRef(0);
  const pinchRef = useRef<{ distance: number; dolly: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    moved: boolean;
    workId: string | null;
  } | null>(null);

  const radius = orbRadius(Math.min(viewport.width, viewport.height));
  const placed = useMemo(() => placeOnSphere(works, radius), [radius]);
  const placedRef = useRef(placed);

  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);
  useEffect(() => {
    placedRef.current = placed;
  }, [placed]);

  const publishPose = useCallback((next: OrbPose) => {
    const radiusNow = orbRadius(
      Math.min(
        viewportRef.current?.clientWidth ?? 1200,
        viewportRef.current?.clientHeight ?? 800,
      ),
    );
    const clamped: OrbPose = {
      pitch: clampPitch(next.pitch),
      yaw: next.yaw,
      dolly: clampDolly(next.dolly, radiusNow),
    };
    poseRef.current = clamped;
    setPose(clamped);
  }, []);

  const stopTween = useCallback(() => {
    if (tweenRef.current !== null) {
      cancelAnimationFrame(tweenRef.current);
      tweenRef.current = null;
    }
  }, []);

  const stopInertia = useCallback(() => {
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
    lastInertiaTimeRef.current = null;
    velocityRef.current = { pitch: 0, yaw: 0 };
  }, []);

  const ensureInertia = useCallback(() => {
    if (prefersReducedMotion()) {
      velocityRef.current = { pitch: 0, yaw: 0 };
      return;
    }
    if (inertiaRafRef.current !== null) return;

    const tick = (now: number) => {
      const last = lastInertiaTimeRef.current ?? now;
      lastInertiaTimeRef.current = now;
      const dt = Math.min(0.032, Math.max(0, (now - last) / 1000));
      const decay = Math.pow(INERTIA_FRICTION, dt * 60);
      const velocity = velocityRef.current;
      velocity.pitch *= decay;
      velocity.yaw *= decay;

      const current = poseRef.current;
      publishPose({
        pitch: current.pitch + velocity.pitch,
        yaw: current.yaw + velocity.yaw,
        dolly: current.dolly,
      });

      if (Math.hypot(velocity.pitch, velocity.yaw) > INERTIA_MIN) {
        inertiaRafRef.current = requestAnimationFrame(tick);
      } else {
        velocityRef.current = { pitch: 0, yaw: 0 };
        inertiaRafRef.current = null;
        lastInertiaTimeRef.current = null;
      }
    };

    inertiaRafRef.current = requestAnimationFrame(tick);
  }, [publishPose]);

  const animateTo = useCallback(
    (target: OrbPose, duration = FOCUS_DURATION) => {
      stopTween();
      stopInertia();
      const from = poseRef.current;
      const start = performance.now();
      const ms = prefersReducedMotion() ? 1 : duration;

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = easeInOutCubic(t);
        publishPose({
          pitch: lerp(from.pitch, target.pitch, eased),
          yaw: lerpAngle(from.yaw, target.yaw, eased),
          dolly: lerp(from.dolly, target.dolly, eased),
        });
        if (t < 1) {
          tweenRef.current = requestAnimationFrame(tick);
        } else {
          tweenRef.current = null;
        }
      };

      tweenRef.current = requestAnimationFrame(tick);
    },
    [publishPose, stopInertia, stopTween],
  );

  const focusWork = useCallback(
    (id: string) => {
      const work = placedRef.current.find((item) => item.id === id);
      if (!work) return;
      const target = rotationToFront(work.x, work.y, work.z);
      setMode("focused");
      setFocusedId(id);
      setHintVisible(false);
      animateTo({
        pitch: clampPitch(target.pitch),
        yaw: target.yaw,
        dolly: clampDolly(FOCUS_DOLLY, radius),
      });
    },
    [animateTo, radius],
  );

  const unfocus = useCallback(() => {
    setMode("overview");
    setFocusedId(null);
    const current = poseRef.current;
    animateTo(
      {
        pitch: current.pitch,
        yaw: current.yaw,
        dolly: DEFAULT_DOLLY,
      },
      420,
    );
  }, [animateTo]);

  const focusRelative = useCallback(
    (delta: number) => {
      const list = placedRef.current;
      if (list.length === 0) return;
      const current = focusedIdRef.current;
      const currentIndex = current
        ? list.findIndex((work) => work.id === current)
        : 0;
      const base = currentIndex >= 0 ? currentIndex : 0;
      const next = list[(base + delta + list.length) % list.length];
      if (next) focusWork(next.id);
    },
    [focusWork],
  );

  const focusInDirection = useCallback(
    (direction: NavDirection) => {
      const current = focusedIdRef.current;
      if (!current) return;
      const { pitch, yaw } = poseRef.current;
      const neighbor = findOrbNeighbor(
        placedRef.current,
        current,
        direction,
        pitch,
        yaw,
      );
      if (neighbor) {
        focusWork(neighbor.id);
        return;
      }
      focusRelative(direction === "left" || direction === "up" ? -1 : 1);
    },
    [focusRelative, focusWork],
  );

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

  const onKeyNavigate = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (modeRef.current === "focused") unfocus();
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
      stopInertia();
    },
    [stopInertia, stopTween],
  );

  const applyDolly = useCallback(
    (nextDolly: number) => {
      const current = poseRef.current;
      publishPose({ ...current, dolly: nextDolly });
      if (
        modeRef.current === "focused" &&
        nextDolly < EXIT_FOCUS_DOLLY
      ) {
        setMode("overview");
        setFocusedId(null);
      }
    },
    [publishPose],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setHintVisible(false);

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
      }

      stopTween();
      const next = poseRef.current.dolly - event.deltaY * 0.45;
      applyDolly(next);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [applyDolly, focusInDirection, stopTween]);

  const consumeSkipClick = () => {
    if (!skipClickRef.current) return false;
    skipClickRef.current = false;
    return true;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stopTween();
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      workId: workIdFromTarget(event.target),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) {
      drag.moved = true;
      skipClickRef.current = true;
      setHintVisible(false);
      if (modeRef.current !== "focused") {
        setIsSpinning(true);
        stopInertia();
      }
    }
    if (drag.moved && modeRef.current !== "focused") {
      const current = poseRef.current;
      const yawDelta = dx * SPIN_SENSITIVITY;
      const pitchDelta = -dy * SPIN_SENSITIVITY;
      velocityRef.current = { yaw: yawDelta, pitch: pitchDelta };
      publishPose({
        pitch: current.pitch + pitchDelta,
        yaw: current.yaw + yawDelta,
        dolly: current.dolly,
      });
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsSpinning(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    if (modeRef.current === "focused" && drag.moved) {
      const direction = directionFromDelta(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        SWIPE_MIN_DISTANCE,
      );
      if (direction) {
        focusInDirection(direction);
        return;
      }
      const id = focusedIdRef.current;
      if (id) focusWork(id);
      return;
    }

    if (drag.moved) {
      ensureInertia();
      return;
    }

    if (drag.workId) {
      skipClickRef.current = true;
      focusWork(drag.workId);
      return;
    }

    if (modeRef.current === "focused") unfocus();
  };

  const onBackgroundClick = () => {
    if (consumeSkipClick()) return;
    if (modeRef.current === "focused") unfocus();
  };

  const onSelectWork = (id: string) => {
    if (consumeSkipClick()) return;
    focusWork(id);
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b) return;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { distance, dolly: poseRef.current.dolly };
      dragRef.current = null;
      setIsSpinning(false);
    }
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b) return;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next =
        pinchRef.current.dolly +
        (distance - pinchRef.current.distance) * 0.55;
      applyDolly(next);
      setHintVisible(false);
    }
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) pinchRef.current = null;
  };

  const focusedWork: OrbWorkData | null = useMemo(() => {
    if (!focusedId) return null;
    return placed.find((work) => work.id === focusedId) ?? null;
  }, [focusedId, placed]);

  const focusedCatalogIndex = useMemo(() => {
    if (!focusedId) return -1;
    return works.findIndex((work) => work.id === focusedId);
  }, [focusedId]);

  const titlePos = useMemo(() => {
    if (!focusedWork) return null;
    const projected = projectToScreen(
      focusedWork.x,
      focusedWork.y,
      focusedWork.z,
      pose.pitch,
      pose.yaw,
      pose.dolly,
      viewport.width,
      viewport.height,
    );
    const visualScale = facingScale(1, true);
    return {
      x: projected.x,
      y:
        projected.y +
        (focusedWork.displayHeight / 2) * visualScale * projected.scale +
        18,
    };
  }, [focusedWork, pose.dolly, pose.pitch, pose.yaw, viewport.height, viewport.width]);

  const pitchDeg = (pose.pitch * 180) / Math.PI;
  const yawDeg = (pose.yaw * 180) / Math.PI;

  return (
    <>
      <div
        ref={viewportRef}
        className={`canvas-viewport orb-viewport${isSpinning ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onBackgroundClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="application"
        aria-label="Art orb"
      >
        <div
          className="orb-rig"
          style={{
            transform: `translateZ(${pose.dolly}px)`,
          }}
        >
          <div
            className="orb-stage"
            style={{
              transform: `rotateX(${pitchDeg}deg) rotateY(${yawDeg}deg)`,
            }}
          >
            {placed.map((work) => {
              const facing = rotatedDepth(
                work.x,
                work.y,
                work.z,
                pose.pitch,
                pose.yaw,
                radius,
              );
              const isFocusedPiece = work.id === focusedId;
              const interactive =
                facing >= FACING_POINTER_MIN && mode !== "focused";
              return (
                <OrbWork
                  key={work.id}
                  work={work}
                  pitch={pose.pitch}
                  yaw={pose.yaw}
                  facing={facing}
                  focused={isFocusedPiece}
                  interactive={interactive}
                  scale={facingScale(facing, isFocusedPiece)}
                  opacity={facingOpacity(facing, mode === "focused", isFocusedPiece)}
                  onSelect={onSelectWork}
                />
              );
            })}
          </div>
        </div>
      </div>

      {focusedWork && titlePos ? (
        <div
          className="canvas-work-name orb-work-name"
          style={{
            left: titlePos.x,
            top: titlePos.y,
            fontSize: 22,
            maxWidth: Math.max(160, focusedWork.displayWidth * 1.35),
          }}
          aria-hidden="true"
        >
          <span className="canvas-work-name-title">{focusedWork.title}</span>
          <span className="canvas-work-name-year">{focusedWork.year}</span>
        </div>
      ) : null}

      {hintVisible ? (
        <p className="canvas-hint">Drag to spin · click a piece</p>
      ) : null}

      {focusedWork?.note ? (
        <div className="canvas-caption">
          <p className="canvas-caption-note">{focusedWork.note}</p>
          <div className="canvas-caption-meta">
            <span className="canvas-caption-index">
              {focusedCatalogIndex >= 0 ? focusedCatalogIndex + 1 : "—"} /{" "}
              {works.length}
            </span>
          </div>
        </div>
      ) : focusedWork ? (
        <div className="canvas-caption canvas-caption-meta-only">
          <div className="canvas-caption-meta">
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
    </>
  );
}
