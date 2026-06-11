import { getReport, listChats, listEvaluations } from "@/lib/repo";
import { buildReportMessage, buildScoreMessage, telegramConfigured } from "@/lib/templates";
import CopyButton from "@/components/CopyButton";
import BandChip from "@/components/BandChip";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const [report, chats, evaluations] = await Promise.all([
    getReport({}),
    listChats(),
    listEvaluations({}),
  ]);
  const chatMap = new Map(chats.map((c) => [c.agr_no, c]));
  const reportMessage = buildReportMessage(report);
  const botReady = telegramConfigured();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Сообщения для Telegram</h1>
        <p className="text-sm text-gray-500">
          v1: только копирование в буфер обмена. Отправка через бота появится
          позже (за {`TELEGRAM_BOT_TOKEN`} / {`TELEGRAM_CHAT_ID`}).{" "}
          {botReady ? "Бот настроен." : "Бот не настроен."}
        </p>
      </div>

      {/* Daily report message */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Сообщение-отчёт (за всё время)</div>
          <div className="flex gap-2">
            <CopyButton label="Копировать отчёт" text={reportMessage} />
            <button className="btn-secondary" disabled title="Доступно после настройки бота">
              Отправить (скоро)
            </button>
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{reportMessage}
        </pre>
      </div>

      {/* Per-chat score messages */}
      <div className="card overflow-x-auto">
        <div className="p-3 text-sm font-medium border-b border-gray-100">
          Сообщения по чатам / оценкам
        </div>
        <table className="qa">
          <thead>
            <tr>
              <th>Дата</th>
              <th>№ / Чат</th>
              <th>Оценка</th>
              <th>Сообщение</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-6">
                  Нет оценок.
                </td>
              </tr>
            )}
            {evaluations.slice(0, 50).map((ev) => {
              const chat = chatMap.get(ev.chat_agr_no) ?? null;
              const msg = buildScoreMessage(ev, chat);
              return (
                <tr key={ev.id}>
                  <td className="whitespace-nowrap">{ev.checking_date}</td>
                  <td>
                    <div className="font-medium">№ {ev.chat_agr_no}</div>
                    <div className="text-gray-500">{chat?.chat_name ?? "—"}</div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">
                        {ev.total_score}
                      </span>
                      <BandChip band={ev.quality_band} />
                    </div>
                  </td>
                  <td className="max-w-md">
                    <pre className="text-xs whitespace-pre-wrap text-gray-600">
{msg}
                    </pre>
                  </td>
                  <td className="whitespace-nowrap">
                    <CopyButton label="Копировать" text={msg} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
