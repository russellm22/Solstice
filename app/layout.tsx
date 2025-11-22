import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Viewer - Solstice",
  description: "Modern PDF viewer with drag-and-drop, zoom, and pan",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}


