import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";
import { UiModeProvider } from "@/contexts/UiModeContext";

export const metadata: Metadata = {
  title: "Price Update Tool",
  description: "Nutrition/supplement retail price update workflow",
};

const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem("price_tool_ui_preferences_v1");var p=raw?JSON.parse(raw):{};var mode=p.mode==="classic"?"classic":"new";var theme=p.theme==="dark"||p.theme==="system"||p.theme==="light"?p.theme:"light";var accent=typeof p.accent==="string"?p.accent:"indigo";var density=p.density==="compact"||p.density==="spacious"?"compact"===p.density?"compact":"spacious":"comfortable";var r=document.documentElement;r.setAttribute("data-ui-mode",mode);r.setAttribute("data-ui-accent",accent);r.setAttribute("data-ui-density",density);var isDark=mode==="new"&&(theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches));if(isDark){r.classList.add("dark");r.style.colorScheme="dark";}else{r.classList.remove("dark");r.style.colorScheme="light";}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-zinc-950 dark:text-zinc-100">
        <UiModeProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </UiModeProvider>
      </body>
    </html>
  );
}
