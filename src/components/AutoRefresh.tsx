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
 * ВАЖНО: обновляемся СРАЗУ при монтировании. Иначе первый экран показывает то,
 * что уже лежало в клиентском Router Cache Next.js — при переходе по ссылке в
 * навбаре это может быть устаревшая (пре-фетч) копия страницы за другой день или
 * до последних оценок. Именно поэтому «правильные данные появлялись только после
 * нескольких обновлений»: до первого тика (45 с) на экране висела кэш-копия.
 * Немедленный refresh на монтировании заменяет её свежими данными с сервера.
 *
 * Safeguards: ONE interval (kept in a ref, so re-renders never stack a second
 * one), listeners cleaned up on unmount, and a refresh is skipped while the tab
 * is hidden or a previous refresh is still in flight — so it never floods the
 * server. The in-flight guard is tied to the transition's real completion (not a
 * fixed timer), and a subtle «Обновление данных…» pill shows only while pending.
 */
export default function AutoRefresh({
  // Жалоба QA «частые обновления страницы»: 45-секундный опрос был слишком
  // частым и страница ощущалась «дёргающейся». Спокойный интервал в 3 минуты
  // сохраняет живость (плюс мгновенный refresh на монтировании и по фокусу), но
  // не обновляет страницу постоянно.
  intervalMs = 180_000,
  label = "Обновление данных…",
}: {
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [mounted, setMounted] = useState(false);

  // Release the in-flight guard when the transition actually settles, so the
  // next tick can run. (The old code cleared it on a fixed 800ms timer, which
  // decoupled the guard from the real refresh and could stack refreshes when a
  // server render took longer than that.)
  useEffect(() => {
    if (!pending) inFlight.current = false;
  }, [pending]);

  useEffect(() => {
    let cancelled = false;
    setMounted(true);

    const tick = () => {
      if (cancelled || inFlight.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight.current = true;
      startTransition(() => {
        router.refresh();
      });
    };

    // Refresh immediately on mount — replace any stale Router Cache payload with
    // fresh server data right away, not only after the first interval.
    tick();

    const id = window.setInterval(tick, Math.max(10_000, intervalMs));
    const onVisible = () => {
      if (typeof document === "undefined" || !document.hidden) tick();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, intervalMs]);

  if (!mounted || !pending) return null;
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
