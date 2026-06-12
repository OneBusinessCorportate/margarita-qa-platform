import { getReport, listAccountants, listChats, listEvaluations } from "@/lib/repo";
import { buildReportMessage, telegramConfigured } from "@/lib/templates";
import { BANDS, MONTHLY_CATEGORIES } from "@/lib/scoring";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";
import BandChip from "@/components/BandChip";
import DashboardFilters from "@/components/DashboardFilters";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; accountant?: string; client?: string };
}) {
  const filters = {
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };
  const [report, accountants, evaluations, chats] = await Promise.all([
    getReport(filters),
    listAccountants(),
    listEvaluations(filters),
    listChats(),
  ]);
  const chatMap = new Map(chats.map((c) => [c.agr_no, c]));
  const reportMessage = buildReportMessage(report);
  const botReady = telegramConfigured();

  const totals = [
    { label: "Активных чатов", value: report.totals.activeChats },
    { label: "Новых чатов", value: report.totals.newChats },
    { label: "Чаты без ответственных", value: report.totals.chatsWithoutResponsible },
    { label: "Оценено чатов всего", value: report.totals.evaluatedChats },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Отчёт</h1>
          <p className="text-sm text-gray-500">
            Ежедневный отчёт по качеству — по дате и бухгалтеру.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton
            label="Копировать отчёт"
            className="btn-primary"
            text={reportMessage}
          />
          <SendTelegramButton text={reportMessage} configured={botReady} />
        </div>
      </div>

      <DashboardFilters
        accountants={accountants.map((a) => a.name)}
        initial={filters}
      />

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {totals.map((t) => (
          <div key={t.label} className="card p-3">
            <div className="text-xs text-gray-500">{t.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>

      {/* Distribution + service quality */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-3 md:col-span-2">
          <div className="text-sm font-medium mb-2">Распределение оценок</div>
          <div className="grid grid-cols-4 gap-2">
            {BANDS.map((b) => (
              <div
                key={b.band}
                className="rounded p-2 text-white"
                style={{ backgroundColor: b.color }}
              >
                <div className="text-xs opacity-90">{b.band}</div>
                <div className="text-2xl font-semibold tabular-nums">
                  {report.distribution[b.band]}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-3 flex flex-col justify-center">
          <div className="text-sm font-medium">Сервис Бухгалтерии</div>
          <div className="text-4xl font-bold tabular-nums">
            {report.serviceQualityPct}%
          </div>
          <div className="text-xs text-gray-500">средняя оценка за период</div>
        </div>
      </div>

      {/* Per-accountant: Сервис Бухгалтерии */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 text-sm font-medium">Сервис Бухгалтерии — по бухгалтерам</div>
        <table className="qa">
          <thead>
            <tr>
              <th>Бухгалтер</th>
              <th>Средняя оценка %</th>
              <th>Оценено</th>
              <th>Низких оценок</th>
            </tr>
          </thead>
          <tbody>
            {report.perAccountant.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-6">
                  Нет данных за выбранный период.
                </td>
              </tr>
            )}
            {report.perAccountant.map((a) => (
              <tr key={a.accountant}>
                <td className="font-medium">{a.accountant}</td>
                <td className="tabular-nums">{a.avgScore < 0 ? "—" : `${a.avgScore}%`}</td>
                <td className="tabular-nums">{a.count}</td>
                <td className="tabular-nums">
                  <span
                    className={a.lowCount > 0 ? "text-red-600 font-medium" : ""}
                  >
                    {a.lowCount}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Задачи Бухгалтерии */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 text-sm font-medium">
          Задачи Бухгалтерии — всего {report.tasks.total} (в срок: {report.tasks.onTime},
          с опозданием: {report.tasks.late}, просрочено: {report.tasks.overdue})
        </div>
        <table className="qa">
          <thead>
            <tr>
              <th>Бухгалтер</th>
              <th>Всего</th>
              <th>В срок</th>
              <th>С опозданием</th>
              <th>Просрочено</th>
            </tr>
          </thead>
          <tbody>
            {report.tasks.perAccountant.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-6">
                  Нет задач за выбранный период.
                </td>
              </tr>
            )}
            {report.tasks.perAccountant.map((a) => (
              <tr key={a.accountant}>
                <td className="font-medium">{a.accountant}</td>
                <td className="tabular-nums">{a.total}</td>
                <td className="tabular-nums">{a.onTime}</td>
                <td className="tabular-nums">{a.late}</td>
                <td className="tabular-nums">
                  <span className={a.overdue > 0 ? "text-red-600 font-medium" : ""}>
                    {a.overdue}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-chat detail: hidden by default (item 2 — open on click). */}
      <details className="card overflow-x-auto">
        <summary className="px-3 py-2 text-sm font-medium cursor-pointer select-none">
          По чатам (оценённые за период) — статусы и качество
        </summary>
        <table className="qa">
          <thead>
            <tr>
              <th>Дата</th>
              <th className="min-w-[180px]">№ / Чат</th>
              <th>Бухгалтер</th>
              {MONTHLY_CATEGORIES.map((c) => (
                <th key={c.id} title={c.name}>
                  {c.shortName}
                </th>
              ))}
              <th>Общая</th>
              <th>Качество</th>
              <th>Чат</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-gray-400 py-6">
                  Нет оценок за период.
                </td>
              </tr>
            )}
            {evaluations.map((ev) => {
              const chat = chatMap.get(ev.chat_agr_no) ?? null;
              const monthly = ev.scores.monthly ?? {};
              return (
                <tr key={ev.id}>
                  <td className="whitespace-nowrap">{ev.checking_date}</td>
                  <td>
                    <div className="font-medium">№ {ev.chat_agr_no}</div>
                    <div className="text-gray-500 text-xs">{chat?.chat_name ?? "—"}</div>
                  </td>
                  <td>{ev.accountant ?? "—"}</td>
                  {MONTHLY_CATEGORIES.map((c) => (
                    <td key={c.id} className="text-xs whitespace-nowrap">
                      {monthly[c.id]?.status || "—"}
                    </td>
                  ))}
                  <td className="tabular-nums font-semibold text-center">{ev.total_score}</td>
                  <td>
                    <BandChip band={ev.quality_band} />
                  </td>
                  <td>
                    {chat?.chat_link ? (
                      <a
                        href={chat.chat_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline whitespace-nowrap"
                      >
                        Открыть ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      {/* Report message preview — hidden by default; the «Копировать отчёт»
          button at the top already copies it. Open only to read the text. */}
      <details className="card p-3 space-y-2">
        <summary className="text-sm font-medium cursor-pointer select-none">
          Текст сообщения для Telegram (отчёт)
        </summary>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{reportMessage}
        </pre>
      </details>
    </div>
  );
}
