import type { Metadata } from "next";
import { Archivo, Instrument_Sans, DM_Mono } from "next/font/google";
import "./globals.css";

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
      <body className="bg-ink text-manila min-h-full flex flex-col font-sans">
        <a href="#main" className="sr-only-focusable">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
