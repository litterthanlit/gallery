import type { Metadata } from "next";
import { Instrument_Sans, Syne } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Art — litt.",
  description:
    "A quiet digital gallery of abstract works by Nick / litt.design.",
  openGraph: {
    title: "Art — litt.",
    description:
      "A quiet digital gallery of abstract works by Nick / litt.design.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrument.variable} ${syne.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
