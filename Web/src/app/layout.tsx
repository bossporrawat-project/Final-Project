import type { Metadata } from "next";
import { Inter, Prompt } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const prompt = Prompt({
  weight: ["400", "500", "600", "700"],
  variable: "--font-prompt",
  subsets: ["latin", "thai"],
});

export const metadata: Metadata = {
  title: "Tracker by boss",
  description: "Precision Meets Clarity",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${inter.variable} ${prompt.variable}`}>
      <body>{children}</body>
    </html>
  );
}
