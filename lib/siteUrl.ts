/**
 * Absolute origin for metadata URLs (Open Graph images need one).
 * Set NEXT_PUBLIC_SITE_URL for a custom domain; on Vercel the production or
 * deployment URL is used automatically; locally it's the dev server.
 */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL(`http://localhost:${process.env.PORT ?? 3000}`);
}
