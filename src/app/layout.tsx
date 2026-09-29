import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Price Update Tool",
  description: "Nutrition/supplement retail price update workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}

