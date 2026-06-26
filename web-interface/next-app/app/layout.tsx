import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Walnut Agent Console",
  description: "WalnutPi Next.js agent console",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
