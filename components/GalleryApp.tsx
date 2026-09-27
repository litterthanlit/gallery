"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CanvasGallery } from "@/components/CanvasGallery";
import { GalleryHeader, type GalleryView } from "@/components/GalleryHeader";
import { OrbGallery } from "@/components/OrbGallery";
import { works } from "@/data/works";

type GalleryAppProps = {
  view: GalleryView;
};

function urlFor(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Owns the URL: `?view=orb` picks the view and `?work=<id>` names the open
 * piece, so any piece can be linked to and Back closes it.
 */
export function GalleryApp({ view }: GalleryAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const workParam = searchParams.get("work");
  const requestedWork = works.some((work) => work.id === workParam)
    ? workParam
    : null;

  // True while the open piece sits on a history entry we pushed, so closing
  // it can step Back instead of leaving a dead entry behind.
  const pushedRef = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Keep the tab title on the open piece while browsing (the server sets it
  // for the first load via generateMetadata).
  useEffect(() => {
    const work = works.find((item) => item.id === requestedWork);
    document.title = work ? `${work.title} — litt.` : "Art — litt.";
  }, [requestedWork]);

  const onFocusChange = useCallback(
    (workId: string | null) => {
      const params = new URLSearchParams(window.location.search);
      const current = params.get("work");
      if (current === workId) return;

      if (workId) params.set("work", workId);
      else params.delete("work");
      const url = urlFor(pathname, params);

      if (workId && !current) {
        window.history.pushState(null, "", url);
        pushedRef.current = true;
      } else if (!workId && pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      } else {
        window.history.replaceState(null, "", url);
      }
    },
    [pathname],
  );

  const onViewChange = (next: GalleryView) => {
    if (next === view) return;
    // Keep the open piece when switching views.
    const params = new URLSearchParams(window.location.search);
    if (next === "orb") params.set("view", "orb");
    else params.delete("view");
    pushedRef.current = false;
    router.replace(urlFor(pathname, params), { scroll: false });
  };

  return (
    <div className="canvas-shell">
      <GalleryHeader view={view} onViewChange={onViewChange} />
      {view === "orb" ? (
        <OrbGallery requestedWork={requestedWork} onFocusChange={onFocusChange} />
      ) : (
        <CanvasGallery requestedWork={requestedWork} onFocusChange={onFocusChange} />
      )}
    </div>
  );
}
