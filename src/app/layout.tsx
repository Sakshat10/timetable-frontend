import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Timetable Maker", template: "%s · Timetable Maker" },
  description: "School timetable planning, generation and daily cover management.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f5f7fa",
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the request headers makes every route render per request, which nonce-based CSP requires
  // (src/lib/security/csp.ts): Next.js applies the nonce from the request's CSP header (set by src/proxy.ts)
  // to its own scripts.
  await headers();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
