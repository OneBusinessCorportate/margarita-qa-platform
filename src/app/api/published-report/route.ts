import { NextResponse } from "next/server";
import { getLatestPublishedReport, publishReport } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The accountant-facing daily report AFTER Margarita edited + approved it.
 * GET  → the latest published report (for the platform preview).
 * POST → publish/approve a report {title, body, report_date?, period_label?}.
 *
 * Storage must be real Supabase in production (the in-memory fallback resets on
 * every serverless invocation, so a published report would "disappear").
 */
function storageError(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && !isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          "Хранилище не настроено: отсутствует ключ Supabase на сервере. Публикация отключена, чтобы не потерять данные.",
      },
      { status: 503 }
    );
  }
  return null;
}

export async function GET() {
  return NextResponse.json((await getLatestPublishedReport()) ?? null);
}

export async function POST(req: Request) {
  const blocked = storageError();
  if (blocked) return blocked;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "Отчёт пустой" }, { status: 400 });
  }
  const session = await getSession();
  const report = await publishReport(
    {
      title: typeof body.title === "string" ? body.title : "Ежедневный отчёт бухгалтерии",
      body: text,
      report_date: typeof body.report_date === "string" ? body.report_date : null,
      period_label: typeof body.period_label === "string" ? body.period_label : null,
    },
    session?.email ?? null
  );
  return NextResponse.json(report, { status: 201 });
}
