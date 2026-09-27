"use client";

import { memo } from "react";
import { WorkImage } from "@/components/WorkImage";
import type { PlacedWork } from "@/lib/canvasLayout";

type CanvasWorkProps = {
  work: PlacedWork;
  x: number;
  y: number;
  angle: number;
  focused: boolean;
  dragging: boolean;
  /**
   * Camera scale, for keeping the focus label a constant size on screen.
   * Only the focused piece needs it; pass 1 otherwise so zooming doesn't
   * re-render every piece.
   */
  cameraScale: number;
  /** Load the tile right away (pieces visible on arrival) or lazily. */
  loading: "lazy" | "eager";
  onSelect: (id: string) => void;
  onGrab: (id: string, event: React.PointerEvent<HTMLButtonElement>) => void;
};

/** Quiet, deterministic micro-tilt so the field isn't a flat collage. */
function tiltForId(id: string): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const x = (((hash % 700) + 700) % 700) / 100 - 3.5; // -3.5 … 3.5 deg
  const y = ((((hash >> 8) % 900) + 900) % 900) / 100 - 4.5; // -4.5 … 4.5 deg
  return { x, y };
}

/**
 * Tiles are requested at this share of their layout width: about 2× what the
 * overview shows, sharp enough while zooming, and a fraction of full size. An
 * opened piece loads its full-resolution layer on top.
 */
const TILE_RESOLUTION = 0.45;

export const CanvasWork = memo(function CanvasWork({
  work,
  x,
  y,
  angle,
  focused,
  dragging,
  cameraScale,
  loading,
  onSelect,
  onGrab,
}: CanvasWorkProps) {
  const tilt = tiltForId(work.id);
  const spinDeg = (angle * 180) / Math.PI;
  const scale = Math.max(cameraScale, 0.001);
  // ~15px on screen; the gap scales so it sits just under the piece.
  const labelSize = 15 / scale;
  const labelGap = 16 / scale;

  return (
    <>
      <button
        type="button"
        className={`canvas-work${focused ? " is-focused" : ""}${dragging ? " is-dragging" : ""}`}
        data-work-id={work.id}
        style={{
          left: x,
          top: y,
          width: work.displayWidth,
          ["--tilt-x" as string]: focused ? "0deg" : `${tilt.x}deg`,
          ["--tilt-y" as string]: focused ? "0deg" : `${tilt.y}deg`,
          ["--spin" as string]: `${spinDeg}deg`,
        }}
        onPointerDown={(event) => {
          onGrab(work.id, event);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(work.id);
        }}
        aria-label={`${work.title}, ${work.year}`}
        aria-pressed={focused}
      >
        <span className="canvas-work-plane" aria-hidden="true" />
        <WorkImage
          work={work}
          tileSizes={`${Math.ceil(work.displayWidth * TILE_RESOLUTION)}px`}
          detailSizes="(max-width: 640px) 90vw, 50vw"
          detail={focused}
          loading={loading}
        />
      </button>

      {focused ? (
        <div
          className="canvas-work-name"
          style={{
            left: x + work.displayWidth / 2,
            top: y + work.displayHeight + labelGap,
            fontSize: labelSize,
          }}
          aria-hidden="true"
        >
          <span className="canvas-work-name-title">{work.title}</span>
          <span className="canvas-work-name-year">{work.year}</span>
        </div>
      ) : null}
    </>
  );
});
