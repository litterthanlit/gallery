import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The social card route reads artwork and fonts from disk at request time.
  outputFileTracingIncludes: {
    "/og": [
      "./public/works/**/*.{jpg,jpeg,png}",
      "./public/logo.png",
      "./node_modules/geist/dist/fonts/geist-sans/Geist-{Medium,Regular}.ttf",
    ],
  },
  // …and never the videos or web fonts it doesn't use.
  outputFileTracingExcludes: {
    "/og": [
      "./public/works/**/*.{mp4,webm,md}",
      "./node_modules/geist/dist/fonts/**/*.woff2",
    ],
  },
  images: {
    // Only the catalog and the logo are run through the optimizer.
    localPatterns: [
      { pathname: "/works/**", search: "" },
      { pathname: "/logo.png", search: "" },
    ],
    // Keep in sync with TILE_QUALITY / DETAIL_QUALITY in components/WorkImage.tsx.
    qualities: [70, 85],
    formats: ["image/avif", "image/webp"],
    // Catalog files are replaced in place rarely; a week is a fair cache.
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },
};

export default nextConfig;
