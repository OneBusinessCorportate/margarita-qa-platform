import Link from "next/link";
import { getReport, listAccountants } from "@/lib/repo";
import { BANDS, STALE_ACTIVITY_DAYS } from "@/lib/scoring";
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
  const [report, accountants] = await Promise.all([
    getReport(filters),
    listAccountants(),
  ]);

  const totals = [
    {
      label: "Активных чатов",
      value: report.totals.activeChats,
      hint: `с активностью за ≤ ${STALE_ACTIVITY_DAYS} дн.`,
    },
    { label: "Новых чатов", value: report.totals.newChats, hint: undefined },
    {
      label: "Чаты без ответственных",
      value: report.totals.chatsWithoutResponsible,
      hint: undefined,
    },
    { label: "Оценено чатов всего", value: report.totals.evaluatedChats, hint: undefined },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Отчёт</h1>
        <p className="text-sm text-gray-500">
          Ежедневный отчёт по качеству — по дате и бухгалтеру.
        </p>
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
            {t.hint && <div className="text-[11px] text-gray-400 mt-0.5">{t.hint}</div>}
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

      {/* Detail lives on its own pages — link instead of repeating it here. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link href="/scoring" className="card p-3 hover:bg-gray-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">По чатам — статусы и качество</div>
            <div className="text-xs text-gray-500">оценки по каждому чату — на странице «Оценка»</div>
          </div>
          <span className="text-blue-600">→</span>
        </Link>
        <Link href="/messages" className="card p-3 hover:bg-gray-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Сообщение для Telegram (отчёт)</div>
            <div className="text-xs text-gray-500">текст и копирование — на странице «Сообщения»</div>
          </div>
          <span className="text-blue-600">→</span>
        </Link>
      </div>
    </div>
  );
}
