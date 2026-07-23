"use client";

import type { PlacedWork } from "@/lib/canvasLayout";

type CanvasWorkProps = {
  work: PlacedWork;
  focused: boolean;
  onSelect: (id: string) => void;
};

export function CanvasWork({ work, focused, onSelect }: CanvasWorkProps) {
  return (
    <button
      type="button"
      className={`canvas-work${focused ? " is-focused" : ""}`}
      style={{
        left: work.x,
        top: work.y,
        width: work.displayWidth,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(work.id);
      }}
      aria-label={`${work.title}, ${work.year}`}
      aria-pressed={focused}
    >
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
