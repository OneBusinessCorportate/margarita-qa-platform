import { NextResponse } from "next/server";
import { createReportSnapshot, listReportSnapshots } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * In production the app MUST talk to Supabase. If the service-role key is
 * missing there, repo() silently falls back to an in-memory store that resets
 * on every serverless invocation — so a saved report "disappears on refresh"
 * and the dashboard looks empty. Fail loudly instead of losing data silently.
 */
function storageError(): NextResponse | null {
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

export async function GET() {
  return NextResponse.json(await listReportSnapshots());
}

// Save the current Отчёт (for the given filters) into history.
export async function POST(req: Request) {
  const blocked = storageError();
  if (blocked) return blocked;
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const filters = {
    from: str(body.from),
    to: str(body.to),
    accountant: str(body.accountant),
    client: str(body.client),
  };
  const session = await getSession();
  const snap = await createReportSnapshot(filters, session?.email ?? null);
  return NextResponse.json(snap, { status: 201 });
}
