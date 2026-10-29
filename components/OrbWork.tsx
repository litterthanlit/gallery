"use client";

import { memo } from "react";
import { WorkImage, WorkTileImage } from "@/components/WorkImage";
import type { OrbTile } from "@/lib/orbLayout";

type StageTile = Pick<
  OrbTile,
  "key" | "id" | "title" | "year" | "src" | "width" | "height" | "video" | "tileSizePx" | "focusSizePx"
>;

type OrbWorkProps = {
  tile: StageTile;
  focused: boolean;
  /** View-specific class; the Ring reuses this tile with its own styles. */
  variant?: "orb-work" | "ring-work";
  /** Cut the still into this grid so the gallery can bend it (the orb). */
  facets?: { cols: number; rows: number };
  register: (key: string, el: HTMLButtonElement | null) => void;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
};

/**
 * One tile on the orb (or the ring). Position, scale, opacity, size and tab
 * order are written every frame by the gallery straight to the DOM, so React
 * only renders this when focus changes.
 */
export const OrbWork = memo(function OrbWork({
  tile,
  focused,
  variant = "orb-work",
  facets,
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
      className={`canvas-work ${variant}${focused ? " is-focused" : ""}`}
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
      {facets ? (
        <span
          className="orb-facets"
          style={{ "--cols": facets.cols, "--rows": facets.rows } as React.CSSProperties}
          aria-hidden="true"
        >
          {Array.from({ length: facets.rows * facets.cols }, (_, index) => {
            const col = index % facets.cols;
            const row = Math.floor(index / facets.cols);
            return (
              <span
                key={index}
                className={`orb-facet${(col + row) % 2 ? " is-under" : ""}`}
                style={{ "--col": col, "--row": row } as React.CSSProperties}
              >
                <WorkTileImage
                  work={tile}
                  sizes={`${tile.tileSizePx}px`}
                  loading="eager"
                  className="orb-facet-image"
                />
              </span>
            );
          })}
        </span>
      ) : null}
      <WorkImage
        work={tile}
        tileSizes={`${tile.tileSizePx}px`}
        detailSizes={`${tile.focusSizePx}px`}
        detail={focused}
        loading="eager"
      />
    </button>
  );
});
