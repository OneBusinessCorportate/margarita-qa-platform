import type { AccountantViolations } from "@/lib/violation-report";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}
const drams = (n: number) => `${n.toLocaleString("ru-RU")} др.`;

/**
 * Разбивка нарушений по каждому бухгалтеру за выбранный период. ЖИВЫЕ данные из
 * журнала «Нарушения» (только то, что внесла Маргарита) — без ИИ и без старых
 * Excel-выгрузок. Единое правило: 1-е нарушение за день — предупреждение (0 др),
 * каждое следующее за тот же день — штраф 1 000 др; ручная санкция перебивает.
 */
export default function AccountantViolationBreakdown({
  perAccountant,
  dateFrom,
  dateTo,
}: {
  perAccountant: AccountantViolations[];
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const withData = perAccountant.filter((g) => g.count > 0);
  const grandTotal = perAccountant.reduce((s, g) => s + g.total, 0);
  const totalWarnings = perAccountant.reduce((s, g) => s + g.warnings, 0);
  const totalPenalties = perAccountant.reduce((s, g) => s + g.penalties, 0);

  return (
    <div className="card p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-700">
          Нарушения по бухгалтерам — чат · тип · предупреждение/штраф
        </div>
        <div className="text-xs text-gray-500">
          За выбранный период ({fmtDate(dateFrom)} — {fmtDate(dateTo)}). Только
          подтверждённые Маргаритой нарушения. Правило: 1-е за день —
          предупреждение (0 др), 2-е и далее за тот же день — штраф 1 000 др;
          ручная санкция перебивает. Предупреждений: {totalWarnings} · штрафов:{" "}
          {totalPenalties} · сумма: {drams(grandTotal)}.
        </div>
      </div>

      <div className="space-y-2">
        {withData.map((g) => (
          <details key={g.employee} className="rounded border border-gray-200">
            <summary className="cursor-pointer select-none px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-gray-800">{g.employeeFull}</span>
              <span className="text-gray-500">
                нарушений: <span className="tabular-nums">{g.count}</span> ·{" "}
                предупр.: <span className="tabular-nums">{g.warnings}</span> ·
                штрафов: <span className="tabular-nums">{g.penalties}</span> ·{" "}
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
                    <th>Статус</th>
                    <th>Комментарий</th>
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
                      <td className="whitespace-nowrap space-x-1">
                        {l.kind === "penalty" ? (
                          <span className="inline-block rounded bg-red-100 text-red-700 font-medium text-xs px-1.5 py-0.5">
                            штраф
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-amber-100 text-amber-700 font-medium text-xs px-1.5 py-0.5">
                            предупреждение
                          </span>
                        )}
                        {l.critical && (
                          <span className="inline-block rounded bg-red-600 text-white font-medium text-xs px-1.5 py-0.5">
                            критично
                          </span>
                        )}
                        {l.appealStatus === "appealed" && (
                          <span className="inline-block rounded bg-blue-100 text-blue-700 font-medium text-xs px-1.5 py-0.5">
                            апелляция
                          </span>
                        )}
                        {l.appealStatus === "approved" && (
                          <span className="inline-block rounded bg-green-100 text-green-700 font-medium text-xs px-1.5 py-0.5">
                            апелляция одобрена
                          </span>
                        )}
                        {l.appealStatus === "rejected" && (
                          <span className="inline-block rounded bg-gray-100 text-gray-600 font-medium text-xs px-1.5 py-0.5">
                            апелляция отклонена
                          </span>
                        )}
                      </td>
                      <td className="max-w-[22rem] whitespace-pre-wrap break-words text-gray-700">
                        {l.note ? l.note : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="tabular-nums whitespace-nowrap">
                        {l.amount > 0 ? (
                          drams(l.amount)
                        ) : (
                          <span className="text-gray-500">—</span>
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
