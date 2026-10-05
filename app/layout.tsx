import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgriCoop Marketplace",
  description: "A cooperative-centered agricultural marketplace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
