import { getDailyAnalytics, listViolations } from "@/lib/repo";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildReportMessage,
  telegramConfigured,
} from "@/lib/templates";
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

  // Per-accountant messages (item 11): one ready-to-send block per person who has
  // a critical chat, a low average, or a chat still waiting. This is what
  // Margarita copies to send each bookkeeper directly — previously the page only
  // produced the single aggregate report, so per-person critical chats (e.g.
  // Olya's) had nowhere to be copied from.
  const perAccountant = accountantsToMessage(report).map((name) => ({
    name,
    text: buildAccountantMessage(report, name, { date: resolved.to }),
    critCount: report.criticalChats.filter((c) => c.accountant === name).length,
    waitingCount: (report.unansweredChats ?? []).filter((c) => c.accountant === name)
      .length,
  }));

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

      {/* Per-accountant messages — copy and send each bookkeeper directly. */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Сообщения бухгалтерам</h2>
          <span className="text-xs text-gray-500">
            {perAccountant.length > 0
              ? `${perAccountant.length} — есть что отправить`
              : "нет критичных / проблемных чатов за период"}
          </span>
        </div>
        {perAccountant.length === 0 ? (
          <div className="card p-4 text-sm text-gray-500">
            За {periodLabel} ни у кого нет критичных чатов, низких оценок или чатов без
            ответа. Отправлять отдельные сообщения не нужно.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {perAccountant.map(({ name, text, critCount, waitingCount }) => (
              <div key={name} className="card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{name}</span>
                    {critCount > 0 && (
                      <span className="inline-block rounded bg-red-100 text-red-700 font-semibold px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                        ⛔️ {critCount}
                      </span>
                    )}
                    {waitingCount > 0 && (
                      <span className="inline-block rounded bg-orange-100 text-orange-700 font-semibold px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                        ⏳ {waitingCount}
                      </span>
                    )}
                  </div>
                  <CopyButton
                    label="Копировать"
                    className="btn-primary !py-0.5 !px-2 text-xs shrink-0"
                    text={text}
                  />
                </div>
                <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{text}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
