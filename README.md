# Art — litt.

A Cosmos-inspired infinite canvas gallery for works from [litt.design/art](https://www.litt.design/art).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How to explore

Switch views from the header: **Field** (endless canvas) or **Orb** (pieces on an invisible sphere). Direct link: `/?view=orb`.

Every open piece has its own link: `/?work=litopia` or `/?view=orb&work=litopia`. Opening a piece adds a history entry, so the browser's **Back** closes it; hopping between pieces updates the link in place, and switching views keeps the open piece.

### Field

- **Pan** through an endless field of works — the map keeps going
- **Drag a piece** to move and toss it — inertia, spin, and collisions
- **Scroll / pinch** to zoom — zoom toward a piece and it **magnetically snaps** into focus
- **Click** a piece to focus
- **Swipe** left / right / up / down (or arrow keys) to move to the nearest neighbor
- **Esc**, click empty space, zoom out, or double-click background to return home

### Orb

- The sphere is tiled with repeats of the catalog so it always reads as a full globe, and drifts slowly when left alone
- **Drag** to spin — fling it for inertia, grab it to catch it
- **Scroll / pinch** to move closer or farther; horizontal trackpad scroll spins
- **Hover** a piece for its title, **click** to bring it forward at full size
- **Swipe**, arrows, or the ‹ › buttons hop to a neighboring piece
- **Esc**, **← Orb**, click empty space, or scroll / pinch out to return
- Keyboard: arrows spin the orb, **Enter** opens the piece facing you, **Tab** moves between visible pieces

## Link previews

Shared links unfurl with a generated card: `/og` for the gallery and `/og?work=<id>` for a single piece (the artwork, title, year and its number in the catalog). Cards are rendered on demand by [`app/og/route.tsx`](app/og/route.tsx) and cached for a week.

Previews need an absolute URL. On Vercel it's picked up automatically; for a custom domain set `NEXT_PUBLIC_SITE_URL` (e.g. `https://art.litt.design`).

## Add a work

1. Drop the image into [`public/works/`](public/works/).
2. Add an entry to [`data/works.ts`](data/works.ts) with `width` / `height` (natural pixel size):

```ts
{
  id: "piece-slug",
  title: "Piece Title",
  year: 2025,
  src: "/works/piece-slug.jpg",
  width: 1600,
  height: 1200,
  note: "Optional one-liner",
}
```

Images are resized and converted (AVIF/WebP) by `next/image` on request, so drop in the full-resolution file. Tiles load a small version and the full-size one loads only when a piece is opened. Animated GIFs can't be resized and are served as-is, so keep them small (or use a video).

## Stack

Next.js App Router, TypeScript, Tailwind CSS v4. Static catalog — no CMS or backend.
