import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

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
    <html lang="en" className={`${GeistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
