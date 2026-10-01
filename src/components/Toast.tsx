"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Spinner } from "./LoadingButton";

type ToastKind = "success" | "error" | "info" | "warning";

type Toast = { id: number; kind: ToastKind; title: string; description?: string };

type ToastApi = {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICON: Record<ToastKind, string> = {
  success: "✓",
  error: "✕",
  info: "i",
  warning: "⚠",
};

const STYLE: Record<ToastKind, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
};

const DEFAULT_TTL_MS = 6000;

/**
 * Lightweight, non-intrusive toast notifications mounted once in the root
 * layout. Gives every async action visible success/error feedback so the user
 * never has to guess whether a click worked.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-4), { id, kind, title, description }]);
      const ttl = kind === "error" ? DEFAULT_TTL_MS * 2 : DEFAULT_TTL_MS;
      timers.current.set(id, setTimeout(() => dismiss(id), ttl));
    },
    [dismiss],
  );

  // Clear pending timers if the provider unmounts.
  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push("success", t, d),
      error: (t, d) => push("error", t, d),
      info: (t, d) => push("info", t, d),
      warning: (t, d) => push("warning", t, d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${STYLE[t.kind]}`}
          >
            <span className="mt-0.5 font-bold">{ICON[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t.title}</div>
              {t.description && <div className="mt-0.5 break-words opacity-80">{t.description}</div>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded px-1 opacity-50 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast API. Falls back to console logging outside the provider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  const noop = useMemo<ToastApi>(
    () => ({
      success: (t) => console.info(t),
      error: (t) => console.error(t),
      info: (t) => console.info(t),
      warning: (t) => console.warn(t),
    }),
    [],
  );
  return ctx ?? noop;
}

/** Small inline spinner for non-button async regions (tables, panels). */
export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-500">
      <Spinner /> {label}
    </span>
  );
}