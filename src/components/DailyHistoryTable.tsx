// Суточная историческая таблица QA: одна строка = бухгалтер × день. Показывает
// сохранённые дневные результаты (они НЕ перезаписываются при новых проверках —
// каждый день хранится отдельно). Требование руководства: «видеть, что было в
// конкретный день». Серверный компонент (только чтение).
import type { DayAccountantAnalytics } from "@/lib/analytics";

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
function weekday(iso: string): string {
  return WD[new Date(iso.slice(0, 10) + "T00:00:00Z").getUTCDay()] ?? "";
}
function scoreColor(pct: number): string {
  if (pct < 0) return "text-gray-300";
  if (pct >= 90) return "text-green-600";
  if (pct >= 80) return "text-lime-600";
  if (pct >= 60) return "text-amber-600";
  return "text-red-600";
}

export default function DailyHistoryTable({
  rows,
  periodLabel,
}: {
  rows: DayAccountantAnalytics[];
  periodLabel: string;
}) {
  // Новые дни сверху; внутри дня — по бухгалтеру.
  const sorted = [...rows].sort(
    (a, b) => b.date.localeCompare(a.date) || a.accountant.localeCompare(b.accountant)
  );

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-700">Суточная история QA (по дням)</div>
        <div className="text-xs text-gray-400 mt-0.5">
          {periodLabel} · один день не перезаписывает другой — историческая разбивка сохраняется
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">
          За выбранный период нет сохранённых дневных результатов.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="px-2 py-2 text-left font-medium whitespace-nowrap">Дата</th>
              <th className="px-2 py-2 text-left font-medium whitespace-nowrap">Бухгалтер</th>
              <th className="px-2 py-2 text-right font-medium" title="Средняя оценка за день">Оценка</th>
              <th className="px-2 py-2 text-right font-medium" title="Проверено чатов">Чатов</th>
              <th className="px-2 py-2 text-right font-medium" title="Оценок «Критично»">Крит.</th>
              <th className="px-2 py-2 text-right font-medium" title="Оценок «Плохо»">Предупр.</th>
              <th className="px-2 py-2 text-right font-medium" title="Нарушений">Наруш.</th>
              <th className="px-2 py-2 text-right font-medium" title="Подано апелляций">Апелл.</th>
              <th className="px-2 py-2 text-right font-medium" title="Апелляций принято">Принято</th>
              <th className="px-2 py-2 text-right font-medium" title="Апелляций отклонено">Откл.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((r) => (
              <tr key={`${r.date}|${r.accountant}`} className="hover:bg-gray-50/60">
                <td className="px-2 py-1.5 whitespace-nowrap text-gray-700">
                  <span className="text-gray-400 mr-1">{weekday(r.date)}</span>
                  {fmtDay(r.date)}
                </td>
                <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{r.accountant}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${scoreColor(r.avgScore)}`}>
                  {r.avgScore < 0 ? "—" : `${r.avgScore}%`}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{r.chatsChecked || ""}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.critical ? "text-red-700 font-semibold" : "text-gray-300"}`}>
                  {r.critical || ""}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{r.warnings || ""}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.violations ? "text-rose-700 font-medium" : "text-gray-300"}`}>
                  {r.violations || ""}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{r.appeals || ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-green-700">{r.appealsApproved || ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{r.appealsRejected || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
