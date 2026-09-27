# Artwork files

Drop image files here using the same names as in `data/works.ts`.

| File | Piece |
| --- | --- |
| `whats-better-than-chaos.jpg` | What's Better Than Chaos |
| `emptiness-surrounding-me.jpg` | Emptiness Surrounding Me |
| `in-the-fire.jpg` | In the Fire |
| `shattered.jpg` | Shattered |
| `unfiltered-projections.jpg` | Unfiltered Projections |
| `untitled-i.jpg` | Untitled I |
| `untitled-ii.jpg` | Untitled II |
| `cacophony-of-the-unsound.jpg` | Cacophony of the Unsound |
| `gust-came-through-like-spring.jpg` | Gust Came Through Like Spring |
| `seeing-through-the-noise.jpg` | Seeing Through the Noise |
| `distorted-light.jpg` | Distorted Light |
| `anarchy.jpg` | Anarchy |
| `compulsive-panic.jpeg` | Compulsive Panic |
| `current-obsession.jpeg` | Current Obsession |
| `untitled-artwork-2.jpg` | Untitled Artwork 2 |
| `signal-in-the-static.jpg` | Signal in the Static |
| `buzz.jpg` | Buzz |
| `litopia.jpg` + `litopia.mp4` + `litopia.webm` | Litopia (poster + motion) |

Preferred: JPG or WebP, ~1600–2400px on the long edge.

Motion pieces ship as a muted MP4 + WebM pair plus a JPG poster frame rather
than a GIF (GIFs can't be resized and are much larger). Both video formats are
needed: some browsers can't decode H.264, others prefer it. From a GIF:

```bash
ffmpeg -i piece.gif -c:v libx264 -preset veryslow -crf 27 -tune animation \
  -pix_fmt yuv420p -movflags +faststart -an piece.mp4
ffmpeg -i piece.gif -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 \
  -pix_fmt yuv420p -an piece.webm
ffmpeg -i piece.gif -frames:v 1 -q:v 1 piece.jpg
```

Width and height must be even for H.264 (add `-vf "crop=trunc(iw/2)*2:trunc(ih/2)*2"` if not).
Until a file is present, the gallery shows a quiet title placeholder.
