"use client";

import { useEffect, useEffectEvent, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Work } from "@/data/works";

type LightboxProps = {
  works: Work[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function Lightbox({
  works,
  index,
  onClose,
  onPrev,
  onNext,
}: LightboxProps) {
  const work = works[index];
  const titleId = useId();
  const isClient = useIsClient();
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );

  const onKeyNavigate = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    if (event.key === "ArrowLeft") onPrev();
    if (event.key === "ArrowRight") onNext();
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      onKeyNavigate(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!work || !isClient) return null;

  return createPortal(
    <div
      className="lightbox animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close"
      >
        Esc
      </button>

      <button
        type="button"
        className="lightbox-nav prev"
        onClick={(event) => {
          event.stopPropagation();
          onPrev();
        }}
        aria-label="Previous work"
      >
        ‹
      </button>

      <button
        type="button"
        className="lightbox-nav next"
        onClick={(event) => {
          event.stopPropagation();
          onNext();
        }}
        aria-label="Next work"
      >
        ›
      </button>

      <div
        className="lightbox-stage"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lightbox-image-wrap animate-scale-in">
          {status !== "loaded" ? (
            <div className="lightbox-placeholder" aria-hidden />
          ) : null}
          {status !== "failed" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={work.id}
              src={work.src}
              alt={work.title}
              className={`h-auto w-auto max-h-[min(72vh,900px)] max-w-full object-contain ${
                status === "loaded" ? "block" : "hidden"
              }`}
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("failed")}
            />
          ) : null}
        </div>
      </div>

      <div
        className="lightbox-caption animate-fade-up"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id={titleId} className="lightbox-title">
            {work.title}
          </h2>
          {work.note ? <p className="lightbox-note">{work.note}</p> : null}
        </div>
        <span className="lightbox-year">{work.year}</span>
      </div>
    </div>,
    document.body,
  );
}
