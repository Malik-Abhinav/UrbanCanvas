import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UrbanCanvas",
  description: "A 2D urban planning sandbox built on real map data."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
