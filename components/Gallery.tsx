"use client";

import Image from "next/image";
import { useState } from "react";
import { works } from "@/data/works";
import { Lightbox } from "@/components/Lightbox";
import { WorkTile } from "@/components/WorkTile";

export function Gallery() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  return (
    <>
      <header className="flex items-center justify-between gap-6 px-5 pt-7 sm:px-8 sm:pt-9 lg:px-12">
        <a
          href="https://www.litt.design"
          className="animate-fade-up inline-flex no-underline"
          style={{ animationDelay: "0ms" }}
          aria-label="litt.design home"
        >
          <Image
            src="/logo.png"
            alt="litt."
            width={723}
            height={814}
            className="h-11 w-auto object-contain sm:h-12"
            priority
          />
        </a>
        <p
          className="animate-fade-up text-sm text-muted tracking-wide"
          style={{ animationDelay: "60ms" }}
        >
          Art
        </p>
      </header>

      <main className="px-5 pb-20 pt-10 sm:px-8 sm:pt-14 lg:px-12 lg:pt-16">
        <h1 className="sr-only">Art gallery</h1>
        <div className="masonry">
          {works.map((work, index) => (
            <WorkTile
              key={work.id}
              work={work}
              index={index}
              onOpen={setActiveIndex}
            />
          ))}
        </div>
      </main>

      {activeIndex !== null ? (
        <Lightbox
          key={works[activeIndex]?.id}
          works={works}
          index={activeIndex}
          onClose={() => setActiveIndex(null)}
          onPrev={() =>
            setActiveIndex(
              (current) =>
                ((current ?? 0) - 1 + works.length) % works.length,
            )
          }
          onNext={() =>
            setActiveIndex(
              (current) => ((current ?? 0) + 1) % works.length,
            )
          }
        />
      ) : null}
    </>
  );
}
