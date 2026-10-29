"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiErrorText } from "@/lib/apiError";
import { LoadingButton, Spinner } from "@/components/LoadingButton";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "setup">("login");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return; // block duplicate submits
    setError("");
    setBusy(true);
    const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let d: { error?: string; message?: string } = {};
      try { d = await r.json(); } catch { d = {}; }

      if (!r.ok) {
        // Generic message for bad credentials so no backend detail leaks;
        // the API's 503 "DatabaseUnavailable" message is still surfaced
        // because it is actionable operator guidance.
        setError(
          r.status === 401
            ? "Invalid email or password."
            : apiErrorText(d, "Sign in failed. Please try again."),
        );
        setBusy(false);
        return;
      }

      // Success: land on the Dashboard automatically, no manual nav click.
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Price Update Tool</h1>
      <p className="mb-4 text-xs text-slate-500 dark:text-zinc-400">
        {mode === "login" ? "Sign in to your enterprise account." : "Create the first admin account."}
      </p>
      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      <form className="flex flex-col gap-3" onSubmit={submit} aria-busy={busy || undefined}>
        <input
          className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          placeholder="Email"
          type="email"
          autoComplete="email"
          required
          disabled={busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          placeholder={mode === "login" ? "Password" : "Password (min 8 characters)"}
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "login" ? undefined : 8}
          disabled={busy}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <LoadingButton
          type="submit"
          busy={busy}
          busyLabel={mode === "login" ? "Signing in..." : "Creating account..."}
          stableWidth
          className="w-full rounded-lg bg-slate-900 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900"
        >
          {mode === "login" ? "Sign In" : "Create Admin Account"}
        </LoadingButton>
      </form>
      {busy && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
          <Spinner /> Please wait...
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        className="mt-3 text-xs text-blue-600 underline disabled:opacity-50"
        onClick={() => { setMode(mode === "login" ? "setup" : "login"); setError(""); }}
      >
        {mode === "login" ? "First run? Create admin account" : "Back to sign in"}
      </button>
    </div>
  );
}
