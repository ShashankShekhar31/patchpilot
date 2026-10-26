import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PatchPilot — Evidence-checked AI code review",
  description:
    "Analyze a diff with an open-weight model, inspect evidence-verified findings, ask follow-ups, generate tests, and export a Markdown review.",
  applicationName: "PatchPilot",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}