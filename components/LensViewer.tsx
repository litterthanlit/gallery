"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { WorkImage } from "@/components/WorkImage";
import type { Work } from "@/data/works";

type LensViewerProps = {
  work: Work;
  index: number;
  total: number;
  /** `sizes` the grid tiles use, so the tile layer is already cached. */
  tileSizes: string;
  /** Screen rect of the tile the piece flies out of / back into, if on screen. */
  originFor: (workId: string) => DOMRect | null;
  /** The piece opened from a tile (fly out of it) rather than from the URL. */
  fromTile: boolean;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  onStep: (delta: number) => void;
};

const OPEN_MS = 560;
const CLOSE_MS = 420;
const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EASE_IN_OUT = "cubic-bezier(0.55, 0, 0.25, 1)";
const SWIPE_MIN_DISTANCE = 56;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keyframe that lays `figure` over the square tile at `origin`: scaled to
 * cover it, then clipped to it, so the piece seems to grow out of its crop.
 */
function tileFrame(figure: DOMRect, origin: DOMRect): Keyframe {
  const scale = Math.max(origin.width / figure.width, origin.height / figure.height);
  const dx = origin.left + origin.width / 2 - (figure.left + figure.width / 2);
  const dy = origin.top + origin.height / 2 - (figure.top + figure.height / 2);
  const insetX = Math.max(0, (figure.width - origin.width / scale) / 2);
  const insetY = Math.max(0, (figure.height - origin.height / scale) / 2);
  const radius = 12 / scale;
  return {
    transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
    clipPath: `inset(${insetY}px ${insetX}px round ${radius}px)`,
  };
}

const REST_FRAME: Keyframe = {
  transform: "translate(0px, 0px) scale(1)",
  clipPath: "inset(0px 0px round 4px)",
};

/** The open piece, over a frosted wash of the grid. */
export function LensViewer({
  work,
  index,
  total,
  tileSizes,
  originFor,
  fromTile,
  closing,
  onClose,
  onClosed,
  onStep,
}: LensViewerProps) {
  const figureRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  /** Last piece animated in (guards against effects running twice in dev). */
  const shownRef = useRef<string | null>(null);
  const swipeRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Opening, and each step to another piece.
  useLayoutEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    if (shownRef.current === work.id) return;
    const first = shownRef.current === null;
    shownRef.current = work.id;
    if (prefersReducedMotion()) return;
    const origin = first && fromTile ? originFor(work.id) : null;
    if (origin) {
      figure.animate([tileFrame(figure.getBoundingClientRect(), origin), REST_FRAME], {
        duration: OPEN_MS,
        easing: EASE_OUT,
      });
    } else {
      figure.animate(
        [
          { opacity: 0, transform: "translateY(10px) scale(0.985)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ],
        { duration: first ? 420 : 320, easing: EASE_OUT },
      );
    }
    // The origin is read once per piece; later tile moves don't matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  // Closing: fly back into the nearest copy of the piece, or just fade.
  useEffect(() => {
    if (!closing) return;
    const figure = figureRef.current;
    const backdrop = backdropRef.current;
    if (!figure || !backdrop || prefersReducedMotion()) {
      onClosed();
      return;
    }
    const origin = originFor(work.id);
    const out = origin
      ? figure.animate([REST_FRAME, tileFrame(figure.getBoundingClientRect(), origin)], {
          duration: CLOSE_MS,
          easing: EASE_IN_OUT,
          fill: "forwards",
        })
      : figure.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.97)" }], {
          duration: 260,
          easing: EASE_IN_OUT,
          fill: "forwards",
        });
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: origin ? CLOSE_MS : 260,
      easing: EASE_IN_OUT,
      fill: "forwards",
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClosed();
    };
    out.finished.then(finish, finish);
    return () => {
      done = true;
    };
    // Runs once per close; the callbacks are stable for its duration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // Move focus into the dialog (the grid behind is inert while it's open).
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onStep(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onStep(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const aspect = work.width / work.height;

  return (
    <div
      className={`lens-viewer${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${work.title}, ${work.year}`}
      onPointerDown={(event) => {
        swipeRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }}
      onPointerUp={(event) => {
        const start = swipeRef.current;
        swipeRef.current = null;
        if (!start || start.id !== event.pointerId || event.pointerType === "mouse") return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.4) {
          onStep(dx < 0 ? 1 : -1);
        } else if (dy > SWIPE_MIN_DISTANCE * 1.5 && dy > Math.abs(dx) * 1.4) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={backdropRef} className="lens-viewer-backdrop" aria-hidden="true" />

      <figure className="lens-viewer-stage" onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <div
          key={work.id}
          ref={figureRef}
          className="lens-figure"
          style={{
            aspectRatio: `${work.width} / ${work.height}`,
            width: `min(var(--lens-figure-max-w), calc(var(--lens-figure-max-h) * ${aspect}))`,
          }}
        >
          <WorkImage
            work={work}
            tileSizes={tileSizes}
            detailSizes="(max-width: 640px) 92vw, 70vw"
            detail
            loading="eager"
          />
        </div>
        <figcaption className="lens-figure-caption" key={`${work.id}-caption`}>
          <span className="canvas-work-name-title">{work.title}</span>
          <span className="canvas-work-name-year">{work.year}</span>
        </figcaption>
      </figure>

      <button
        ref={closeRef}
        type="button"
        className="orb-close"
        aria-label="Back to the lens"
        aria-keyshortcuts="Escape"
        onClick={onClose}
      >
        <span aria-hidden="true">← Lens</span>
        <kbd className="orb-close-key" aria-hidden="true">
          Esc
        </kbd>
      </button>

      <div className={`canvas-caption${work.note ? "" : " canvas-caption-meta-only"}`}>
        {work.note ? <p className="canvas-caption-note">{work.note}</p> : null}
        <div className="canvas-caption-meta">
          <span className="canvas-caption-index">
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="canvas-focus-nav">
        <button
          type="button"
          className="canvas-nav-btn"
          onClick={() => onStep(-1)}
          aria-label="Previous work"
          aria-keyshortcuts="ArrowLeft"
        >
          ‹
        </button>
        <button
          type="button"
          className="canvas-nav-btn"
          onClick={() => onStep(1)}
          aria-label="Next work"
          aria-keyshortcuts="ArrowRight"
        >
          ›
        </button>
      </div>

      <p className="sr-only" aria-live="polite">
        {`${work.title}, ${work.year}. ${index + 1} of ${total}.`}
      </p>
    </div>
  );
}
