import type { Metadata, Viewport } from "next";
import { Geist_Mono, Schibsted_Grotesk, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// Depot Design System typefaces: Schibsted Grotesk for body/UI, Bricolage
// Grotesque for the display wordmark, Geist Mono for code/monospace.
const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Hermes • Martuni",
  description: "Leichte Chat-Oberfläche für Hermes",
};

// Mobile-first viewport: device-width, no max-scale lock (accessibility) and a
// theme colour matching the Depot green so the browser chrome blends in.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#128a63",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${schibsted.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
