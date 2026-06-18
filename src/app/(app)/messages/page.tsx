import { getDailyAnalytics, listViolations } from "@/lib/repo";
import { buildReportMessage, telegramConfigured } from "@/lib/templates";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";

export const dynamic = "force-dynamic";

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

// The ONE place to copy/send the daily analytics — the dashboard links here
// instead of repeating the text and buttons. Accepts the same date / accountant
// query params as the dashboard so a specific day or range can be deep-linked;
// with no params it resolves to the latest day that actually has evaluations
// (a TRUE daily, not the whole-history aggregate the old page produced).
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    accountant?: string;
    client?: string;
  };
}) {
  const filters = {
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  const [{ report, previous, resolved }, violations] = await Promise.all([
    getDailyAnalytics(filters),
    listViolations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
  ]);

  const reportMessage = buildReportMessage(report, {
    violations,
    previous,
    // Set REPORT_SHEET_URL (e.g. on Render) to append the Google-Sheet link.
    sheetUrl: process.env.REPORT_SHEET_URL,
  });
  const botReady = telegramConfigured();

  const periodLabel =
    resolved.from === resolved.to
      ? fmtDay(resolved.from)
      : `${fmtDay(resolved.from)} — ${fmtDay(resolved.to)}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Сообщение для Telegram</h1>
        <p className="text-sm text-gray-500">
          Аналитика за <span className="font-medium">{periodLabel}</span>
          {previous ? " · с трендом к прошлому периоду" : ""}.{" "}
          {botReady
            ? "Бот настроен — кнопка «Отправить в Telegram» активна."
            : "Бот не настроен (задайте TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, чтобы включить отправку)."}
        </p>
      </div>

      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Аналитика качества</div>
          <div className="flex gap-2">
            <CopyButton label="Копировать отчёт" className="btn-primary" text={reportMessage} />
            <SendTelegramButton text={reportMessage} configured={botReady} />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{reportMessage}
        </pre>
      </div>
    </div>
  );
}
