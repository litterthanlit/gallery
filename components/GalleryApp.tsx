"use client";

import { useRouter, usePathname } from "next/navigation";
import { CanvasGallery } from "@/components/CanvasGallery";
import { GalleryHeader, type GalleryView } from "@/components/GalleryHeader";
import { OrbGallery } from "@/components/OrbGallery";

type GalleryAppProps = {
  view: GalleryView;
};

export function GalleryApp({ view }: GalleryAppProps) {
  const router = useRouter();
  const pathname = usePathname();

  const onViewChange = (next: GalleryView) => {
    if (next === view) return;
    router.replace(next === "orb" ? `${pathname}?view=orb` : pathname, {
      scroll: false,
    });
  };

  return (
    <div className="canvas-shell">
      <GalleryHeader view={view} onViewChange={onViewChange} />
      {view === "orb" ? <OrbGallery /> : <CanvasGallery />}
    </div>
  );
}
