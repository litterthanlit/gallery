import type { Metadata } from "next";
import { GalleryApp } from "@/components/GalleryApp";
import type { GalleryView } from "@/components/GalleryHeader";
import { works } from "@/data/works";

type SearchParams = Promise<{
  view?: string | string[];
  work?: string | string[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A link to one piece carries its title, so shared links say what they open. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const id = first((await searchParams).work);
  const work = works.find((item) => item.id === id);
  if (!work) return {};
  const title = `${work.title} — litt.`;
  const description =
    work.note ?? `${work.title} (${work.year}) — abstract work by Nick / litt.design.`;
  const image = {
    url: `/og?work=${encodeURIComponent(work.id)}`,
    width: 1200,
    height: 630,
    alt: `${work.title}, ${work.year}`,
  };
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const value = first((await searchParams).view);
  const view: GalleryView = value === "orb" ? "orb" : "field";
  return <GalleryApp view={view} />;
}
