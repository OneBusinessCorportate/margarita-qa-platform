import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Shared guards for write API routes.
//
// The data layer (repo.ts) silently falls back to an in-memory store when
// Supabase isn't configured (great for local dev / CI, dangerous in prod: a
// serverless instance "saves" a row, returns 201, then loses it on the next
// invocation — the classic "I saved it but it's gone on refresh"). And most
// write routes `await` the repo call with no try/catch, so a real DB error
// surfaces as an opaque 500 with no message and the UI silently reverts.
//
// These helpers make both failures loud and legible.
// ---------------------------------------------------------------------------

/**
 * In production, refuse a write when Supabase isn't configured. Returns a 503
 * response to short-circuit the handler, or null when it's safe to proceed
 * (dev/CI still use the in-memory store).
 */
export function storageGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && !isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          "Хранилище не настроено: отсутствует ключ Supabase (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL) на сервере. Сохранение отключено, чтобы не потерять данные — задайте переменные окружения в настройках деплоя (Render/Vercel).",
      },
      { status: 503 }
    );
  }
  return null;
}

/**
 * Turn a thrown repo/DB error into a clean JSON response instead of an opaque
 * 500. PostgREST's "no rows" (PGRST116, from `.single()` on a missing row)
 * becomes a 404 so the client can tell "not found" from "server broke".
 */
export function dbErrorResponse(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : String(e ?? "Ошибка базы данных");
  const notFound = /PGRST116|Results contain 0 rows|0 rows/i.test(msg);
  return NextResponse.json(
    { error: notFound ? "Запись не найдена" : msg },
    { status: notFound ? 404 : 500 }
  );
}
