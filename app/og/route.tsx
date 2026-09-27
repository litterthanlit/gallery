import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { works, type Work } from "@/data/works";

const WIDTH = 1200;
const HEIGHT = 630;
const PAD = 64;

const BG = "#f7f5f2";
const INK = "#1a1917";
const MUTED = "#6b6760";
const FAINT = "#9a958c";

// Files read at request time; listed in `outputFileTracingIncludes` so they
// ship with the function when deployed.
const root = process.cwd();
const fontDir = join(root, "node_modules/geist/dist/fonts/geist-sans");

async function loadFonts() {
  const [medium, regular] = await Promise.all([
    readFile(join(fontDir, "Geist-Medium.ttf")),
    readFile(join(fontDir, "Geist-Regular.ttf")),
  ]);
  return [
    { name: "Geist", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: regular, weight: 400 as const, style: "normal" as const },
  ];
}

/** Fit `work` inside a box, keeping its aspect ratio. */
function fit(work: Work, maxW: number, maxH: number) {
  const scale = Math.min(maxW / work.width, maxH / work.height);
  return {
    width: Math.round(work.width * scale),
    height: Math.round(work.height * scale),
  };
}

/**
 * The artwork as a small JPEG data URL. Source files run to 3 MB; shrinking
 * first keeps rendering fast (Satori only takes PNG/JPEG).
 */
async function artwork(work: Work, width: number): Promise<string> {
  const file = join(root, "public", work.src.replace(/^\//, ""));
  const jpeg = await sharp(file)
    .resize({ width: Math.round(width * 1.5), withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

async function logo(): Promise<string> {
  const png = await readFile(join(root, "public/logo.png"));
  return `data:image/png;base64,${png.toString("base64")}`;
}

const shadow =
  "0 2px 4px rgba(26,25,23,0.06), 0 18px 40px rgba(26,25,23,0.16), 0 40px 80px rgba(26,25,23,0.12)";

const background = {
  backgroundColor: BG,
  backgroundImage:
    "radial-gradient(circle at 10% 0%, #f3e8e0 0%, rgba(243,232,224,0) 55%), radial-gradient(circle at 95% 10%, #e4eaf2 0%, rgba(228,234,242,0) 50%)",
};

async function workCard(work: Work) {
  const box = fit(work, 600, HEIGHT - PAD * 2);
  const [src, mark] = await Promise.all([artwork(work, box.width), logo()]);
  const index = works.findIndex((item) => item.id === work.id) + 1;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: PAD,
        fontFamily: "Geist",
        color: INK,
        ...background,
      }}
    >
      <div
        style={{
          width: 620,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          width={box.width}
          height={box.height}
          alt=""
          style={{ borderRadius: 2, boxShadow: shadow }}
        />
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          paddingLeft: 56,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} width={39} height={44} alt="" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: work.title.length > 22 ? 52 : 62,
              fontWeight: 500,
              letterSpacing: "-0.025em",
              lineHeight: 1.08,
            }}
          >
            {work.title}
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 24,
              fontWeight: 400,
              color: FAINT,
              letterSpacing: "0.08em",
            }}
          >
            {work.video ? `${work.year} · Motion` : String(work.year)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            fontWeight: 400,
            color: MUTED,
            letterSpacing: "0.04em",
          }}
        >
          <span>litt.design — Art</span>
          <span style={{ color: FAINT }}>
            {String(index).padStart(2, "0")} / {String(works.length).padStart(2, "0")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Site card: a loose fan of pieces beside the gallery name. */
async function siteCard() {
  const picks = ["distorted-light", "anarchy", "shattered", "unfiltered-projections"]
    .map((id) => works.find((work) => work.id === id))
    .filter((work): work is Work => Boolean(work));
  const fan = picks.length >= 3 ? picks : works.slice(0, 4);
  const placements = [
    { left: 10, top: 118, rotate: -7, max: 250 },
    { left: 170, top: 40, rotate: 3, max: 290 },
    { left: 300, top: 150, rotate: -2, max: 260 },
    { left: 150, top: 250, rotate: 6, max: 230 },
  ];
  const [mark, ...images] = await Promise.all([
    logo(),
    ...fan.map((work, i) => {
      const box = fit(work, placements[i]!.max, placements[i]!.max);
      return artwork(work, box.width).then((src) => ({ work, box, src }));
    }),
  ]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: PAD,
        fontFamily: "Geist",
        color: INK,
        ...background,
      }}
    >
      <div
        style={{
          width: 520,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mark} width={39} height={44} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 112, fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1 }}>
            Art
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 30,
              fontWeight: 400,
              color: MUTED,
              lineHeight: 1.35,
              letterSpacing: "-0.01em",
            }}
          >
            A quiet digital gallery of abstract works by Nick.
          </div>
        </div>
        <div style={{ fontSize: 20, fontWeight: 400, color: FAINT, letterSpacing: "0.04em" }}>
          {`${works.length} works · litt.design`}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", position: "relative" }}>
        {images.map(({ work, box, src }, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={work.id}
            src={src}
            width={box.width}
            height={box.height}
            alt=""
            style={{
              position: "absolute",
              left: placements[i]!.left,
              top: placements[i]!.top,
              transform: `rotate(${placements[i]!.rotate}deg)`,
              borderRadius: 2,
              boxShadow: shadow,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Open Graph / social card. `/og?work=<id>` renders that piece; `/og` renders
 * the site card. Referenced from the page's metadata.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("work");
  const work = works.find((item) => item.id === id);

  try {
    const [element, fonts] = await Promise.all([
      work ? workCard(work) : siteCard(),
      loadFonts(),
    ]);
    return new ImageResponse(element, {
      width: WIDTH,
      height: HEIGHT,
      fonts,
      headers: {
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("OG image failed", error);
    return new Response("Failed to generate the image", { status: 500 });
  }
}
