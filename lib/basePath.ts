/**
 * The gallery is served at litt.design/art (litt.design proxies /art to this
 * app), so every route and asset lives under this prefix. Next adds it to
 * links, router calls and its own assets automatically; `withBase` covers the
 * places it doesn't: next/image and <video> sources, the History API, and
 * metadata image URLs.
 */
export const BASE_PATH = "/art";

export function withBase(path: string): string {
  if (!path.startsWith("/")) return path;
  // The gallery root is "/art", not "/art/" (so "/?work=x" -> "/art?work=x").
  if (path === "/" || path.startsWith("/?")) return `${BASE_PATH}${path.slice(1)}`;
  return `${BASE_PATH}${path}`;
}
