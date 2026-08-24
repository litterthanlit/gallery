"use client";

import type { OrbWork as OrbWorkData } from "@/lib/orbLayout";

type OrbWorkProps = {
  work: OrbWorkData;
  pitch: number;
  yaw: number;
  facing: number;
  focused: boolean;
  interactive: boolean;
  scale: number;
  opacity: number;
  onSelect: (id: string) => void;
};

export function OrbWork({
  work,
  pitch,
  yaw,
  facing,
  focused,
  interactive,
  scale,
  opacity,
  onSelect,
}: OrbWorkProps) {
  const pitchDeg = (pitch * 180) / Math.PI;
  const yawDeg = (yaw * 180) / Math.PI;

  return (
    <button
      type="button"
      className={`canvas-work orb-work${focused ? " is-focused" : ""}`}
      data-work-id={work.id}
      tabIndex={interactive || focused ? 0 : -1}
      style={{
        width: work.displayWidth,
        opacity,
        zIndex: focused ? 200 : Math.round(facing * 100),
        pointerEvents: interactive || focused ? "auto" : "none",
        transform: `translate(-50%, -50%) translate3d(${work.x}px, ${work.y}px, ${work.z}px) rotateY(${-yawDeg}deg) rotateX(${-pitchDeg}deg) scale(${scale})`,
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
