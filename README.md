# Art — litt.

A minimal, browse-only digital gallery for works from [litt.design/art](https://www.litt.design/art).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Add a work

1. Drop the image into [`public/works/`](public/works/) (see naming in that folder’s README).
2. Add an entry to [`data/works.ts`](data/works.ts):

```ts
{
  id: "piece-slug",
  title: "Piece Title",
  year: 2025,
  src: "/works/piece-slug.jpg",
  note: "Optional one-liner for the lightbox",
}
```

Until the image file exists, the tile and lightbox show a quiet title placeholder.

## Controls

- Click a work → fullscreen lightbox
- `Esc` or backdrop click → close
- `←` / `→` → previous / next

## Stack

Next.js App Router, TypeScript, Tailwind CSS v4. Static catalog — no CMS or backend.
