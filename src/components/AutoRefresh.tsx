"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Live data refresh for server-rendered pages without a full browser reload
 * (п.8 / файл-2). Controlled polling + refresh-on-focus via `router.refresh()`,
 * which re-runs the (force-dynamic) server component and streams new data into
 * the current DOM — no white flash, no lost scroll. Works identically whether
 * Supabase or the in-memory fallback backs the page.
 *
 * Safeguards: ONE interval (kept in a ref, so re-renders never stack a second
 * one), listeners cleaned up on unmount, and a refresh is skipped while the tab
 * is hidden or a previous refresh is still in flight — so it never floods the
 * server. Shows a subtle «Обновление данных…» pill only while refreshing.
 */
export default function AutoRefresh({
  intervalMs = 45_000,
  label = "Обновление данных…",
}: {
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [show, setShow] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled || inFlight.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight.current = true;
      setShow(true);
      startTransition(() => {
        router.refresh();
      });
      // The transition's pending flag clears when the server render lands; give
      // the indicator a short minimum so it doesn't flicker.
      window.setTimeout(() => {
        inFlight.current = false;
        setShow(false);
      }, 800);
    };

    const id = window.setInterval(tick, Math.max(10_000, intervalMs));
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router, intervalMs]);

  if (!show && !pending) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-sky-50 text-sky-700 text-xs px-2 py-0.5 no-print"
      aria-live="polite"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
      {label}
    </span>
  );
}
