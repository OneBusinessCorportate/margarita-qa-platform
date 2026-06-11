import { getReport, listChats, listEvaluations } from "@/lib/repo";
import {
  buildReportMessage,
  buildScoreMessage,
  surveyInviteAm,
  surveyInviteRu,
  telegramConfigured,
} from "@/lib/templates";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";
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
          Копируйте в буфер обмена или отправляйте напрямую через бота.{" "}
          {botReady
            ? "Бот настроен — кнопка «Отправить в Telegram» активна."
            : "Бот не настроен (задайте TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, чтобы включить отправку)."}
        </p>
      </div>

      {/* Daily report message */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Сообщение-отчёт (за всё время)</div>
          <div className="flex gap-2">
            <CopyButton label="Копировать отчёт" text={reportMessage} />
            <SendTelegramButton text={reportMessage} configured={botReady} />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{reportMessage}
        </pre>
      </div>

      {/* Client survey invitations (AM / RU) */}
      <div className="card overflow-x-auto">
        <div className="p-3 text-sm font-medium border-b border-gray-100">
          Приглашение на опрос (AM / RU) — по чатам
        </div>
        <table className="qa">
          <thead>
            <tr>
              <th>№ / Чат</th>
              <th>RU</th>
              <th>AM</th>
            </tr>
          </thead>
          <tbody>
            {chats.slice(0, 50).map((c) => (
              <tr key={c.agr_no}>
                <td>
                  <div className="font-medium">№ {c.agr_no}</div>
                  <div className="text-gray-500 text-xs">{c.chat_name}</div>
                </td>
                <td>
                  <CopyButton label="Копировать RU" text={surveyInviteRu(c)} />
                </td>
                <td>
                  <CopyButton label="Պատճենել AM" text={surveyInviteAm(c)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
                    <div className="flex gap-1">
                      <CopyButton label="Копировать" text={msg} />
                      <SendTelegramButton text={msg} configured={botReady} label="Отправить" />
                    </div>
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
