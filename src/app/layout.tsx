import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";
import { UiModeProvider } from "@/contexts/UiModeContext";

export const metadata: Metadata = {
  title: "Price Update Tool",
  description: "Nutrition/supplement retail price update workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 transition-colors">
        <UiModeProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </UiModeProvider>
      </body>
    </html>
  );
}
