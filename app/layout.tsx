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

// Mobile-first viewport: device-width, no max-scale lock (accessibility).
// theme-color is NOT set here — it's theme-dependent, so the inline script below
// owns the <meta name="theme-color"> (green in light, the dark surface in dark)
// and the sidebar toggle updates it. A single owner avoids duplicate metas.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      data-theme="light"
      suppressHydrationWarning
      className={`${schibsted.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the saved theme before first paint to avoid a light→dark flash.
            Reads localStorage (key `hermes-theme`), else the OS preference, sets
            data-theme on <html> (globals.css flips the palette off it), and sets
            the browser-chrome <meta name="theme-color"> to match — green in
            light, the dark top-bar surface in dark. Creates the meta if absent so
            it's the sole owner regardless of metadata injection order. The colours
            mirror --brand and the dark --surface in globals.css.
            suppressHydrationWarning on <html> lets this DOM write win over the
            server-rendered default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("hermes-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",d?"dark":"light");var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m)}m.setAttribute("content",d?"#161c1a":"#128a63")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
