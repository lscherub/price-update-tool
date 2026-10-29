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

const STYLE: Record<ToastKind, string> = {
  success: "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-950 dark:text-emerald-100",
  error: "border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/80 text-red-950 dark:text-red-100",
  info: "border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/80 text-blue-950 dark:text-blue-100",
  warning: "border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/80 text-amber-950 dark:text-amber-100",
};

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") {
    return (
      <svg className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />
      </svg>
    );
  }
  if (kind === "warning") {
    return (
      <svg className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

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
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur-xs transition-all ${STYLE[t.kind]}`}
          >
            <ToastIcon kind={t.kind} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-xs">{t.title}</div>
              {t.description && <div className="mt-0.5 text-xs break-words opacity-85">{t.description}</div>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Dismiss notification"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
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