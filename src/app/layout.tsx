import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "AgentForge",
  description:
    "Describe what you want in plain language. AgentForge builds a real, executable, visually editable workflow whose agent nodes reason at runtime.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
