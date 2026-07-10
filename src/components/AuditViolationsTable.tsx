"use client";

import { useMemo, useState } from "react";
import type { AuditViolation } from "@/lib/employee-audit";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

/**
 * Журнал исправленных нарушений (только валидные сотрудники). Фильтр по
 * сотруднику и по подтверждению, плюс постраничный показ — список большой.
 */
export default function AuditViolationsTable({
  violations,
  employees,
}: {
  violations: AuditViolation[];
  employees: { short: string; full: string }[];
}) {
  const [emp, setEmp] = useState<string>("");
  const [conf, setConf] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);

  const filtered = useMemo(() => {
    return violations.filter((v) => {
      if (emp && v.employee !== emp) return false;
      if (conf === "yes" && !v.confirmed) return false;
      if (conf === "no" && v.confirmed) return false;
      return true;
    });
  }, [violations, emp, conf]);

  const shown = filtered.slice(0, limit);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          className="input"
          value={emp}
          onChange={(e) => {
            setEmp(e.target.value);
            setLimit(50);
          }}
        >
          <option value="">Все сотрудники</option>
          {employees.map((e) => (
            <option key={e.short} value={e.short}>
              {e.full}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={conf}
          onChange={(e) => setConf(e.target.value)}
        >
          <option value="">Все статусы</option>
          <option value="yes">Подтверждённые</option>
          <option value="no">На проверке</option>
        </select>
        <span className="text-gray-500">
          Показано {shown.length} из {filtered.length}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="qa dense">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сотрудник</th>
              <th>Клиент / компания</th>
              <th>Тяжесть</th>
              <th>Тип нарушения</th>
              <th>Объяснение</th>
              <th>Санкция</th>
              <th>Статус</th>
              <th>Источник</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-gray-400 py-6">
                  Нет нарушений по выбранным фильтрам.
                </td>
              </tr>
            )}
            {shown.map((v, i) => (
              <tr key={i}>
                <td className="tabular-nums whitespace-nowrap">{fmtDate(v.date)}</td>
                <td className="whitespace-nowrap">{v.employeeFull}</td>
                <td>{v.client ?? "—"}</td>
                <td className="whitespace-nowrap">
                  <span
                    className={
                      v.gross || /критич/i.test(v.severity ?? "")
                        ? "text-red-700 font-medium"
                        : ""
                    }
                  >
                    {v.severity ?? "—"}
                  </span>
                </td>
                <td>{v.type ?? "—"}</td>
                <td className="max-w-[28rem]">{v.explanation ?? "—"}</td>
                <td className="tabular-nums whitespace-nowrap">
                  {v.amount > 0
                    ? `${v.amount.toLocaleString("ru-RU")} др.`
                    : "предупреждение"}
                </td>
                <td className="whitespace-nowrap">
                  {v.confirmed ? (
                    <span className="text-green-700">Подтверждено</span>
                  ) : (
                    <span className="text-amber-600">На проверке</span>
                  )}
                </td>
                <td className="text-gray-500 whitespace-nowrap">{v.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {limit < filtered.length && (
        <div className="text-center">
          <button
            className="btn-secondary"
            onClick={() => setLimit((l) => l + 100)}
          >
            Показать ещё
          </button>
        </div>
      )}
    </div>
  );
}
