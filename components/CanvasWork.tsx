"use client";

import type { PlacedWork } from "@/lib/canvasLayout";

type CanvasWorkProps = {
  work: PlacedWork;
  focused: boolean;
  onSelect: (id: string) => void;
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

export function CanvasWork({ work, focused, onSelect }: CanvasWorkProps) {
  const tilt = tiltForId(work.id);

  return (
    <button
      type="button"
      className={`canvas-work${focused ? " is-focused" : ""}`}
      style={{
        left: work.x,
        top: work.y,
        width: work.displayWidth,
        ["--tilt-x" as string]: `${tilt.x}deg`,
        ["--tilt-y" as string]: `${tilt.y}deg`,
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
  );
}
