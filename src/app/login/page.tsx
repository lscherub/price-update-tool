"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "setup">("login");
  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border bg-white p-6">
      <h1 className="text-xl font-bold">Price Update Tool</h1>
      <p className="mb-4 text-sm text-slate-500">
        {mode === "login" ? "Sign in to continue." : "Create the first admin account."}
      </p>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
          const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
          const d = await r.json();
          if (!r.ok) { setError(d.error ?? "Failed"); return; }
          router.push("/");
          router.refresh();
        }}
      >
        <input className="rounded border px-3 py-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="rounded border px-3 py-2" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="rounded bg-slate-900 py-2 text-sm font-semibold text-white">{mode === "login" ? "Sign in" : "Create admin"}</button>
      </form>
      <button className="mt-3 text-xs text-blue-600 underline" onClick={() => setMode(mode === "login" ? "setup" : "login")}>
        {mode === "login" ? "First run? Create admin account" : "Back to sign in"}
      </button>
    </div>
  );
}
