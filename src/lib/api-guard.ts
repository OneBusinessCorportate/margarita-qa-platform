import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { WorkflowError } from "@/lib/violation-workflow";

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
 * Extract a human-readable message from anything that was thrown. Supabase /
 * PostgREST reject with a PLAIN OBJECT ({ message, details, hint, code }), NOT
 * an Error instance — so `String(e)` on it yields the useless "[object Object]"
 * that surfaced to QA in the UI (she pressed «Оценить» and saw «[object
 * Object]»). Pull `.message` (falling back to `.details`, then the pg `code`)
 * so a real DB failure is legible instead of opaque.
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint].filter(
      (p): p is string => typeof p === "string" && p.trim() !== ""
    );
    if (parts.length) {
      return typeof o.code === "string" && o.code
        ? `${parts.join(" — ")} (${o.code})`
        : parts.join(" — ");
    }
    if (typeof o.code === "string" && o.code) return `Ошибка базы данных (${o.code})`;
  }
  const s = String(e ?? "").trim();
  return s && s !== "[object Object]" ? s : "Ошибка базы данных";
}

/**
 * Turn a thrown repo/DB error into a clean JSON response instead of an opaque
 * 500. PostgREST's "no rows" (PGRST116, from `.single()` on a missing row)
 * becomes a 404 so the client can tell "not found" from "server broke".
 */
export function dbErrorResponse(e: unknown): NextResponse {
  // Domain workflow errors carry their own intended HTTP status + safe message
  // (validation 400, ownership 403, not-found 404, conflict 409). WorkflowError
  // and SystemTaskError both expose a numeric `httpStatus`; honor any such error.
  if (e instanceof WorkflowError) {
    return NextResponse.json({ error: e.message }, { status: e.httpStatus });
  }
  if (e instanceof Error) {
    const status = (e as unknown as { httpStatus?: unknown }).httpStatus;
    if (typeof status === "number") {
      return NextResponse.json({ error: e.message }, { status });
    }
  }
  const msg = errorMessage(e);
  const notFound = /PGRST116|Results contain 0 rows|0 rows/i.test(msg);
  return NextResponse.json(
    { error: notFound ? "Запись не найдена" : msg },
    { status: notFound ? 404 : 500 }
  );
}
