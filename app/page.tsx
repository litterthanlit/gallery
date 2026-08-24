import { GalleryApp } from "@/components/GalleryApp";
import type { GalleryView } from "@/components/GalleryHeader";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.view;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const view: GalleryView = value === "orb" ? "orb" : "field";
  return <GalleryApp view={view} />;
}
