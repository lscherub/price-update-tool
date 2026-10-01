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
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border bg-white p-6">
      <h1 className="text-xl font-bold">Price Update Tool</h1>
      <p className="mb-4 text-sm text-slate-500">
        {mode === "login" ? "Sign in to continue." : "Create the first admin account."}
      </p>
      {error && (
        <div role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <form className="flex flex-col gap-3" onSubmit={submit} aria-busy={busy || undefined}>
        <input
          className="rounded border px-3 py-2 disabled:opacity-60"
          placeholder="Email"
          type="email"
          autoComplete="email"
          required
          disabled={busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="rounded border px-3 py-2 disabled:opacity-60"
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
          className="w-full rounded bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {mode === "login" ? "Sign In" : "Create Admin Account"}
        </LoadingButton>
      </form>
      {busy && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
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
