import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "mapbox-gl/dist/mapbox-gl.css";
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
  const fixturesEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_TEST_FIXTURES === "1" &&
    process.env.NEXT_PUBLIC_E2E_TEST_FIXTURES === "1";
  const content = fixturesEnabled ? children : <ClerkProvider>{children}</ClerkProvider>;

  return (
    <html lang="en">
      <body>{content}</body>
    </html>
  );
}
