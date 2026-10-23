import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger · Paper Markets",
  description: "Practice investing with virtual portfolios, synthetic market history, and optional live quotes.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
