import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Suspense } from "react";
import { PlayerProvider } from "@/components/PlayerProvider";
import { AppHeader } from "@/components/AppHeader";
import { PageTransition } from "@/components/PageTransition";

// The same three families Google Fonts serves (Archivo with its width axis,
// Instrument Sans, DM Mono), self-hosted from @fontsource so a build or a dev
// server never needs to reach fonts.googleapis.com — the sandboxed dev
// environment has no route to it, and a build that depends on a third host is
// a build that can fail for reasons that have nothing to do with the code.
const archivo = localFont({
  src: [
    {
      path: "../../../../node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-archivo",
  display: "swap",
});
const instrument = localFont({
  src: [
    {
      path: "../../../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
      weight: "400 700",
      style: "normal",
    },
  ],
  variable: "--font-instrument",
  display: "swap",
});
const dmMono = localFont({
  src: [
    {
      path: "../../../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../../../node_modules/@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PokeCard Simulator",
  description:
    "Open packs, build a collection, work the market. A Pokémon TCG collector's life simulator.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${instrument.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="bg-ink text-manila font-sans flex min-h-full flex-col">
        <a href="#main" className="sr-only-focusable">Skip to content</a>
        {/* The shell lives above the router, so the header survives every
            navigation instead of being re-created by each page. */}
        <PlayerProvider>
          <AppHeader />
          <main id="main" className="vitrine-ambient flex-1">
            <Suspense fallback={null}>
              <PageTransition>{children}</PageTransition>
            </Suspense>
          </main>
        </PlayerProvider>
      </body>
    </html>
  );
}
