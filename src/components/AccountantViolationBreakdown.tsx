import type { PerAccountantViolations } from "@/lib/employee-audit";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}
const drams = (n: number) => `${n.toLocaleString("ru-RU")} др.`;

/**
 * Разбивка нарушений по каждому бухгалтеру для ежедневного отчёта:
 * код проблемного чата — тип нарушения — сумма штрафа. Данные — из
 * исправленного аудита (только 14 валидных сотрудников). Суммы посчитаны по
 * правилам «Условия»: Среднее — 1-е за неделю предупреждение, 2-е и далее
 * 1 000 др; Критичное — 2 000; Грубое — эскалация.
 */
export default function AccountantViolationBreakdown({
  perAccountant,
  dateFrom,
  dateTo,
}: {
  perAccountant: PerAccountantViolations[];
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const withData = perAccountant.filter((g) => g.count > 0);
  const grandTotal = perAccountant.reduce((s, g) => s + g.total, 0);

  return (
    <div className="card p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-700">
          Нарушения по бухгалтерам — чат · тип · сумма
        </div>
        <div className="text-xs text-gray-500">
          Из исправленного журнала нарушений ({fmtDate(dateFrom)} —{" "}
          {fmtDate(dateTo)}). Суммы по правилам «Условия»: Среднее — 1-е за
          неделю предупреждение, 2-е и далее 1 000 др., Критичное — 2 000 др.,
          Грубое — эскалация. Итого: {drams(grandTotal)}.
        </div>
      </div>

      <div className="space-y-2">
        {withData.map((g) => (
          <details key={g.employee} className="rounded border border-gray-200">
            <summary className="cursor-pointer select-none px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-gray-800">{g.employeeFull}</span>
              <span className="text-gray-500">
                нарушений: <span className="tabular-nums">{g.count}</span> · штраф:{" "}
                <span className="tabular-nums font-semibold text-red-700">
                  {drams(g.total)}
                </span>
              </span>
            </summary>
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="qa dense">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Код чата</th>
                    <th>Тип нарушения</th>
                    <th>Тяжесть</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="tabular-nums whitespace-nowrap">
                        {fmtDate(l.date)}
                      </td>
                      <td className="whitespace-nowrap font-medium">
                        {l.chatCode ?? (
                          <span className="text-gray-400">
                            {l.client ? l.client.slice(0, 24) : "—"}
                          </span>
                        )}
                      </td>
                      <td>{l.type ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        <span
                          className={
                            l.gross || /критич/i.test(l.severity ?? "")
                              ? "text-red-700 font-medium"
                              : ""
                          }
                        >
                          {l.severity ?? "—"}
                        </span>
                      </td>
                      <td className="tabular-nums whitespace-nowrap">
                        {l.amount > 0 ? (
                          drams(l.amount)
                        ) : (
                          <span className="text-gray-500">предупреждение</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
