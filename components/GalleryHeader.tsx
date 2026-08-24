"use client";

import Image from "next/image";

export type GalleryView = "field" | "orb";

type GalleryHeaderProps = {
  view: GalleryView;
  onViewChange: (view: GalleryView) => void;
};

export function GalleryHeader({ view, onViewChange }: GalleryHeaderProps) {
  return (
    <header className="canvas-header">
      <a
        href="https://www.litt.design"
        className="canvas-logo"
        aria-label="litt.design home"
      >
        <Image
          src="/logo.png"
          alt="litt."
          width={723}
          height={814}
          className="h-10 w-auto object-contain sm:h-11"
          priority
        />
      </a>

      <div className="gallery-view-toggle" role="tablist" aria-label="Gallery view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "field"}
          className={`gallery-view-btn${view === "field" ? " is-active" : ""}`}
          onClick={() => onViewChange("field")}
        >
          Field
        </button>
        <span className="gallery-view-sep" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          role="tab"
          aria-selected={view === "orb"}
          className={`gallery-view-btn${view === "orb" ? " is-active" : ""}`}
          onClick={() => onViewChange("orb")}
        >
          Orb
        </button>
      </div>

      <p className="canvas-header-label">Art</p>
    </header>
  );
}
