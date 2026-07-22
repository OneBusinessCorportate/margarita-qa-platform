"use client";

// Сортируемая таблица «по бухгалтерам за период» — все ключевые метрики QA в
// одном месте (оценка, проверки, чаты, качество, нарушения, апелляции). Клик по
// заголовку сортирует. Данные приходят готовыми из buildAnalytics.
import { useMemo, useState } from "react";
import type { AccountantAnalytics } from "@/lib/analytics";

type Key =
  | "accountant"
  | "avgScore"
  | "evaluations"
  | "chatsChecked"
  | "excellent"
  | "good"
  | "warnings"
  | "critical"
  | "violations"
  | "appeals"
  | "appealsApproved"
  | "appealsRejected";

const COLUMNS: { key: Key; label: string; title?: string; num: boolean }[] = [
  { key: "accountant", label: "Бухгалтер", num: false },
  { key: "avgScore", label: "Средняя", title: "Средняя оценка за период, %", num: true },
  { key: "evaluations", label: "Проверок", title: "Кол-во проверок (оценок)", num: true },
  { key: "chatsChecked", label: "Чатов", title: "Уникальных проверенных чатов", num: true },
  { key: "excellent", label: "Отл.", title: "Оценок «Отлично» (90–100)", num: true },
  { key: "good", label: "Хор.", title: "Оценок «Хорошо» (80–89)", num: true },
  { key: "warnings", label: "Предупр.", title: "Оценок «Плохо» (60–79)", num: true },
  { key: "critical", label: "Крит.", title: "Оценок «Критично» (<60)", num: true },
  { key: "violations", label: "Наруш.", title: "Подтверждённых нарушений", num: true },
  { key: "appeals", label: "Апелл.", title: "Подано апелляций", num: true },
  { key: "appealsApproved", label: "Принято", title: "Апелляций принято", num: true },
  { key: "appealsRejected", label: "Отклонено", title: "Апелляций отклонено", num: true },
];

function scoreColor(pct: number): string {
  if (pct < 0) return "text-gray-300";
  if (pct >= 90) return "text-green-600";
  if (pct >= 80) return "text-lime-600";
  if (pct >= 60) return "text-amber-600";
  return "text-red-600";
}

export default function AnalyticsTable({ rows }: { rows: AccountantAnalytics[] }) {
  const [sortKey, setSortKey] = useState<Key>("avgScore");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      if (sortKey === "accountant") {
        return asc
          ? a.accountant.localeCompare(b.accountant)
          : b.accountant.localeCompare(a.accountant);
      }
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return asc ? av - bv : bv - av;
    });
    return out;
  }, [rows, sortKey, asc]);

  function onSort(key: Key) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "accountant");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-gray-400">
        За выбранный период данных по бухгалтерам нет.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-700">Сводка по бухгалтерам за период</div>
        <div className="text-xs text-gray-400 mt-0.5">
          Клик по заголовку — сортировка. ⚠ — мало проверенных чатов (оценка нерепрезентативна).
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-gray-500">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                title={c.title}
                className={`px-2 py-2 font-medium cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 ${
                  c.num ? "text-right" : "text-left"
                } ${c.key === "accountant" ? "sticky left-0 bg-gray-50" : ""}`}
              >
                {c.label}
                {sortKey === c.key && <span className="ml-0.5">{asc ? "▲" : "▼"}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((r) => (
            <tr key={r.accountant} className="hover:bg-gray-50/60">
              <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white">
                {r.accountant}
              </td>
              <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${scoreColor(r.avgScore)}`}>
                {r.avgScore < 0 ? "—" : `${r.avgScore}%`}
                {r.lowSample && r.avgScore >= 0 && (
                  <span className="ml-0.5 text-amber-500" title="мало проверенных чатов">⚠</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{r.evaluations}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{r.chatsChecked}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-green-700">{r.excellent || ""}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-lime-700">{r.good || ""}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">{r.warnings || ""}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${r.critical ? "text-red-700 font-semibold" : "text-gray-300"}`}>
                {r.critical || ""}
              </td>
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
    </div>
  );
}
