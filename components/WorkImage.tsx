"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Work } from "@/data/works";

/** Must match `images.qualities` in next.config.ts. */
const TILE_QUALITY = 70;
const DETAIL_QUALITY = 85;
/** Keep the sharp layer around while a piece shrinks back, so it doesn't pop. */
const DETAIL_LINGER_MS = 900;

type WorkImageProps = {
  work: Work;
  /** `sizes` for the always-on tile image — its largest on-screen width. */
  tileSizes: string;
  /** `sizes` for the sharp layer shown while the piece is open. */
  detailSizes: string;
  /** Load and show the sharp layer. */
  detail: boolean;
  loading?: "lazy" | "eager";
};

/**
 * A work as two optimized images: a small tile that always loads, and a
 * large one that only loads when the piece is opened and fades in over it.
 */
export function WorkImage({
  work,
  tileSizes,
  detailSizes,
  detail,
  loading = "lazy",
}: WorkImageProps) {
  // Animated GIFs can't be resized by the optimizer — serve them as-is, once.
  const animated = work.src.toLowerCase().endsWith(".gif");
  const [lingering, setLingering] = useState(detail);
  const [detailLoaded, setDetailLoaded] = useState(false);
  if (detail && !lingering) setLingering(true);

  useEffect(() => {
    if (detail) return;
    const timer = window.setTimeout(() => {
      setLingering(false);
      setDetailLoaded(false);
    }, DETAIL_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [detail]);

  const showDetail = !animated && (detail || lingering);

  return (
    <>
      <Image
        src={work.src}
        alt=""
        width={work.width}
        height={work.height}
        sizes={tileSizes}
        quality={TILE_QUALITY}
        loading={loading}
        unoptimized={animated}
        draggable={false}
        className="canvas-work-image"
      />
      {showDetail ? (
        <Image
          src={work.src}
          alt=""
          width={work.width}
          height={work.height}
          sizes={detailSizes}
          quality={DETAIL_QUALITY}
          loading="eager"
          fetchPriority="high"
          draggable={false}
          onLoad={() => setDetailLoaded(true)}
          className={`canvas-work-image-detail${detailLoaded ? " is-loaded" : ""}`}
        />
      ) : null}
    </>
  );
}
