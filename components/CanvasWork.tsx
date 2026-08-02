"use client";

import type { PlacedWork } from "@/lib/canvasLayout";

type CanvasWorkProps = {
  work: PlacedWork;
  x: number;
  y: number;
  angle: number;
  focused: boolean;
  dragging: boolean;
  /** Camera scale — used to keep the focus label readable on screen. */
  cameraScale: number;
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

export function CanvasWork({
  work,
  x,
  y,
  angle,
  focused,
  dragging,
  cameraScale,
  onSelect,
  onGrab,
}: CanvasWorkProps) {
  const tilt = tiltForId(work.id);
  const spinDeg = (angle * 180) / Math.PI;
  const scale = Math.max(cameraScale, 0.001);
  // ~22px on screen, gap scales so it sits just under the piece.
  const labelSize = 22 / scale;
  const labelGap = 18 / scale;

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={work.src}
          alt={work.title}
          width={work.width}
          height={work.height}
          draggable={false}
          className="canvas-work-image"
        />
      </button>

      {focused ? (
        <div
          className="canvas-work-name"
          style={{
            left: x + work.displayWidth / 2,
            top: y + work.displayHeight + labelGap,
            fontSize: labelSize,
            maxWidth: work.displayWidth * 1.15,
          }}
          aria-hidden="true"
        >
          <span className="canvas-work-name-title">{work.title}</span>
          <span className="canvas-work-name-year">{work.year}</span>
        </div>
      ) : null}
    </>
  );
}
