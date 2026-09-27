"use client";

import { memo } from "react";
import type { OrbTile } from "@/lib/orbLayout";

type OrbWorkProps = {
  tile: OrbTile;
  focused: boolean;
  register: (key: string, el: HTMLButtonElement | null) => void;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
};

/**
 * One tile on the orb. Position, scale, opacity, size and tab order are
 * written every frame by OrbGallery straight to the DOM, so React only
 * renders this when focus changes.
 */
export const OrbWork = memo(function OrbWork({
  tile,
  focused,
  register,
  onSelect,
  onHover,
}: OrbWorkProps) {
  return (
    <button
      ref={(el) => {
        register(tile.key, el);
        return () => register(tile.key, null);
      }}
      type="button"
      className={`canvas-work orb-work${focused ? " is-focused" : ""}`}
      data-tile-key={tile.key}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(tile.key);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onHover(tile.key);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") onHover(null);
      }}
      onFocus={() => onHover(tile.key)}
      onBlur={() => onHover(null)}
      aria-label={`${tile.title}, ${tile.year}`}
      aria-pressed={focused}
    >
      <span className="canvas-work-plane" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tile.src}
        alt=""
        width={tile.width}
        height={tile.height}
        draggable={false}
        decoding="async"
        className="canvas-work-image"
      />
    </button>
  );
});
