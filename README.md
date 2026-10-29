# Art — litt.

A gallery for works from [litt.design/art](https://www.litt.design/art).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How to explore

The site opens on the **Ring** (pieces standing along the rim of an invisible crater). Switch to the **Orb** (pieces on an invisible sphere) or the **Field** (an endless masonry wall) from the header, or link to them directly: `/?view=orb`, `/?view=field`.

Every open piece has its own link: `/?work=litopia` or `/?view=field&work=litopia`. Opening a piece adds a history entry, so the browser's **Back** closes it; hopping between pieces updates the link in place, and switching views keeps the open piece. Old `/?view=ring` links still work.

### Ring

The catalog stands in order along the rim of an invisible crater, each piece at its own height on a mountainous ridge, like a slow procession.

- **Drag** sideways to turn the ring, up / down to tilt it — flings carry momentum, and it drifts when left alone
- **Scroll / pinch** to move closer or farther; horizontal trackpad scroll turns it
- **Click** a piece to bring it forward; the rest of the ring dims and the camera eases in
- **Swipe**, arrows, or the ‹ › buttons step to the next or previous piece around the ring
- **Esc**, **← Ring**, click empty space, or scroll / pinch out to return
- Keyboard: ← → turn one piece at a time, ↑ ↓ tilt, **Enter** opens the piece in front

The ridge's shape (relief height, the slow swell) lives in [`lib/ringLayout.ts`](lib/ringLayout.ts).

### Orb

- The sphere is tiled with repeats of the catalog so it always reads as a full globe, and drifts slowly when left alone
- Pieces lie on the surface, bent to its curve and spaced apart; the far side shows faintly through the gaps
- **Drag** to spin — fling it for inertia, grab it to catch it
- **Scroll / pinch** to move closer or farther; horizontal trackpad scroll spins
- **Hover** a piece for its title, **click** to peel it off the sphere and bring it forward, flat and at full size
- **Swipe**, arrows, or the ‹ › buttons hop to a neighboring piece
- **Esc**, **← Orb**, click empty space, or scroll / pinch out to return
- Keyboard: arrows spin the orb, **Enter** opens the piece facing you, **Tab** moves between visible pieces

### Field

A Cosmos-style infinite canvas with roomier gutters: equal-width columns of work at their true proportions, repeating in every direction. Each column cycles through the whole catalog in its own order, so every piece is always nearby.

- **Drag** or **scroll** (trackpad) to wander — flings carry a little momentum
- **Pinch** or **⌘/Ctrl + scroll** to zoom at the cursor
- **Click** a piece to bring it up; the rest of the wall steps back
- **Swipe**, arrows, or the ‹ › buttons hop to the neighboring piece
- **Esc**, **← Field**, click empty space, or scroll away to return
- Keyboard: arrows pan the wall, **Enter** opens the piece in the middle

Layout constants (column width, gutter, how many columns fit) live in [`lib/fieldLayout.ts`](lib/fieldLayout.ts).

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
