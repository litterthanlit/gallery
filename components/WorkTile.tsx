"use client";

import { useState } from "react";
import type { Work } from "@/data/works";

type WorkTileProps = {
  work: Work;
  index: number;
  onOpen: (index: number) => void;
};

export function WorkTile({ work, index, onOpen }: WorkTileProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );

  return (
    <button
      type="button"
      className="work-tile masonry-item animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
      onClick={() => onOpen(index)}
      aria-label={`View ${work.title}, ${work.year}`}
    >
      <div className="work-media">
        {status !== "loaded" ? <div className="placeholder" aria-hidden /> : null}
        {status !== "failed" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={work.src}
            alt={work.title}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              status === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("failed")}
          />
        ) : null}
      </div>
      <div className="work-meta">
        <span className="work-title">{work.title}</span>
        <span className="work-year">{work.year}</span>
      </div>
    </button>
  );
}
