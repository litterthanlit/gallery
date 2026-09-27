import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { siteUrl } from "@/lib/siteUrl";
import "./globals.css";
import { withBase } from "@/lib/basePath";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Art — litt.",
  description:
    "A quiet digital gallery of abstract works by Nick / litt.design.",
  openGraph: {
    title: "Art — litt.",
    description:
      "A quiet digital gallery of abstract works by Nick / litt.design.",
    type: "website",
    images: [{ url: withBase("/og"), width: 1200, height: 630, alt: "Art — litt." }],
  },
  twitter: {
    card: "summary_large_image",
    images: [withBase("/og")],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
