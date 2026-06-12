import { getReport } from "@/lib/repo";
import { buildReportMessage, telegramConfigured } from "@/lib/templates";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";

export const dynamic = "force-dynamic";

// The ONE place to copy/send the daily report — the dashboard links here
// instead of repeating the text and buttons.
export default async function MessagesPage() {
  const report = await getReport({});
  const reportMessage = buildReportMessage(report);
  const botReady = telegramConfigured();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Сообщение для Telegram</h1>
        <p className="text-sm text-gray-500">
          {botReady
            ? "Бот настроен — кнопка «Отправить в Telegram» активна."
            : "Бот не настроен (задайте TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, чтобы включить отправку)."}
        </p>
      </div>

      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Ежедневный отчёт</div>
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
