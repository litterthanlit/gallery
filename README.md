# Art — litt.

A Cosmos-inspired infinite canvas gallery for works from [litt.design/art](https://www.litt.design/art).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How to explore

- **Drag** to pan the field
- **Scroll / pinch** to zoom — zoom toward a piece and it **magnetically snaps** into focus
- **Click** a piece to focus
- **Swipe** left / right / up / down (or arrow keys) to move to the nearest neighbor
- **Esc**, click empty space, zoom out, or double-click background to fit all

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

## Stack

Next.js App Router, TypeScript, Tailwind CSS v4. Static catalog — no CMS or backend.
