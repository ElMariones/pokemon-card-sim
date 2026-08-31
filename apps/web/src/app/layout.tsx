import type { Metadata } from "next";
import { Archivo, Instrument_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { PlayerProvider } from "@/components/PlayerProvider";
import { AppHeader } from "@/components/AppHeader";
import { PageTransition } from "@/components/PageTransition";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});
const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});
const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
            <PageTransition>{children}</PageTransition>
          </main>
        </PlayerProvider>
      </body>
    </html>
  );
}
