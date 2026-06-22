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
      data-theme="light"
      suppressHydrationWarning
      className={`${schibsted.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the saved theme before first paint to avoid a light→dark flash.
            Reads localStorage (key `hermes-theme`), else the OS preference, and
            sets data-theme on <html>; globals.css flips the palette off it.
            suppressHydrationWarning on <html> lets this DOM write win over the
            server-rendered default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("hermes-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
