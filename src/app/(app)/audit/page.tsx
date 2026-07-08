import { buildEmployeeAudit } from "@/lib/employee-audit";
import AuditViolationsTable from "@/components/AuditViolationsTable";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-green-700"
      : tone === "warn"
      ? "text-amber-600"
      : tone === "bad"
      ? "text-red-700"
      : "text-gray-900";
  return (
    <div className="card p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

export default async function AuditPage() {
  const a = buildEmployeeAudit();
  const drams = (n: number) => `${n.toLocaleString("ru-RU")} др.`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Аудит сотрудников</h1>
        <p className="text-sm text-gray-500">
          Только действующие сотрудники из утверждённого списка. Нарушения,
          штрафы и бонусы пересчитаны из приложенных файлов ({a.meta.violationSource}
          {" · "}
          {a.meta.kkSource}). Период нарушений: {fmtDate(a.meta.dateFrom)} —{" "}
          {fmtDate(a.meta.dateTo)}.
        </p>
      </div>

      {/* Сводные счётчики */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Всего валидных" value={a.totals.validCount} tone="good" />
        <StatCard label="Отсутствуют где-то" value={a.totals.missingCount} tone="warn" />
        <StatCard label="Невалидных найдено" value={a.totals.invalidCount} tone="bad" />
        <StatCard label="Нарушений (исправл.)" value={a.totals.violationCount} />
        <StatCard label="Штрафы, всего" value={drams(a.totals.penaltiesTotal)} tone="bad" />
        <StatCard label="Бонусов" value={a.totals.bonusCount} tone="good" />
        <StatCard label="Ручная проверка" value={a.totals.reviewCount} tone="warn" />
      </div>

      {a.totals.droppedViolations > 0 && (
        <p className="text-xs text-gray-500">
          Из исходных {a.meta.violationCount} строк нарушений отброшено{" "}
          {a.totals.droppedViolations} — записаны на невалидных, пустых или
          неоднозначных сотрудников (см. разделы «Невалидные имена» и «Ручная
          проверка»).
        </p>
      )}

      {/* A. Валидные сотрудники */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          A. Действующие сотрудники ({a.valid.length})
        </h2>
        <div className="card overflow-x-auto">
          <table className="qa dense">
            <thead>
              <tr>
                <th>#</th>
                <th>ФИО</th>
                <th>Короткое имя</th>
                <th>Грейд</th>
                <th>Возможные написания</th>
              </tr>
            </thead>
            <tbody>
              {a.valid.map((e, i) => (
                <tr key={e.short}>
                  <td className="tabular-nums">{i + 1}</td>
                  <td className="font-medium">{e.canonical}</td>
                  <td>{e.short}</td>
                  <td>{e.role ?? "—"}</td>
                  <td className="text-gray-500">{e.aliases.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* B. Отсутствующие сотрудники */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          B. Отсутствующие сотрудники / Отсутствующие в источниках
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="card p-3">
            <div className="text-sm font-medium mb-1">Нет в КК Сопровождении</div>
            <ul className="text-sm text-gray-700 list-disc pl-4">
              {a.missing.kk.length === 0 ? (
                <li className="text-gray-400 list-none">— все на месте</li>
              ) : (
                a.missing.kk.map((n) => <li key={n}>{n}</li>)
              )}
            </ul>
          </div>
          <div className="card p-3">
            <div className="text-sm font-medium mb-1">Нет в листе «KPI»</div>
            <ul className="text-sm text-gray-700 list-disc pl-4">
              {a.missing.kpi.length === 0 ? (
                <li className="text-gray-400 list-none">— все на месте</li>
              ) : (
                a.missing.kpi.map((n) => <li key={n}>{n}</li>)
              )}
            </ul>
          </div>
          <div className="card p-3">
            <div className="text-sm font-medium mb-1">
              Нет нарушений (нет записей в журнале)
            </div>
            <ul className="text-sm text-gray-700 list-disc pl-4">
              {a.missing.violations.length === 0 ? (
                <li className="text-gray-400 list-none">— у всех есть записи</li>
              ) : (
                a.missing.violations.map((n) => <li key={n}>{n}</li>)
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* C. Невалидные имена */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          C. Невалидные имена, найденные в данных ({a.invalidNames.length})
        </h2>
        <p className="text-xs text-gray-500 mb-2">
          Эти имена встречаются в файлах, но не входят в утверждённый список
          (уволенные, другие отделы, служебные пометки). Их записи исключены из
          расчётов.
        </p>
        <div className="card overflow-x-auto">
          <table className="qa dense">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Нарушений (отброшено)</th>
                <th>Где встречается</th>
              </tr>
            </thead>
            <tbody>
              {a.invalidNames.map((n) => (
                <tr key={n.name}>
                  <td className="font-medium">{n.name}</td>
                  <td className="tabular-nums">{n.violationCount}</td>
                  <td className="text-gray-500">{n.sources.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Требует ручной проверки */}
      {a.reviewNames.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-2">
            Требует ручной проверки ({a.reviewNames.length})
          </h2>
          <p className="text-xs text-gray-500 mb-2">
            Имя похоже на сотрудника, но однозначно сопоставить нельзя — не
            гадаем. Например «Լիլիթ 2» / «Лилит - 2» может быть третьей Лилит, с
            которой сотрудничество прекращено (лист «Проблемы и достижения»).
          </p>
          <div className="card overflow-x-auto">
            <table className="qa dense">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Нарушений</th>
                  <th>Где встречается</th>
                </tr>
              </thead>
              <tbody>
                {a.reviewNames.map((n) => (
                  <tr key={n.name}>
                    <td className="font-medium">{n.name}</td>
                    <td className="tabular-nums">{n.violationCount}</td>
                    <td className="text-gray-500">{n.sources.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* E. Штрафы и бонусы */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          E. Штрафы и бонусы (из листа «KPI и результаты»)
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="card overflow-x-auto">
            <div className="px-3 pt-3 text-sm font-medium">
              Штрафы (санкции) — всего {drams(a.totals.penaltiesTotal)}
            </div>
            <table className="qa dense">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Месяц</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {a.penalties.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-gray-400 py-4">
                      Нет штрафов
                    </td>
                  </tr>
                )}
                {a.penalties.map((p, i) => (
                  <tr key={i}>
                    <td>{p.employeeFull}</td>
                    <td>{p.month}</td>
                    <td className="tabular-nums">{drams(p.amount ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card overflow-x-auto">
            <div className="px-3 pt-3 text-sm font-medium">
              Бонусы — {a.bonuses.length}
            </div>
            <table className="qa dense">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Месяц</th>
                  <th>Бонус</th>
                </tr>
              </thead>
              <tbody>
                {a.bonuses.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-center text-gray-400 py-4">
                      Нет бонусов
                    </td>
                  </tr>
                )}
                {a.bonuses.map((b, i) => (
                  <tr key={i}>
                    <td>{b.employeeFull}</td>
                    <td>{b.month}</td>
                    <td>{b.amount ? drams(b.amount) : b.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* F. Сравнение по источникам */}
      <section>
        <h2 className="text-base font-semibold mb-2">F. Сравнение по источникам</h2>
        <div className="card overflow-x-auto">
          <table className="qa dense">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Список</th>
                <th>КК Сопровождение</th>
                <th>Клиентов (Active)</th>
                <th>Журнал нарушений</th>
                <th>Нарушений</th>
                <th>Лист KPI</th>
              </tr>
            </thead>
            <tbody>
              {a.sourceMatrix.map((s) => {
                const yn = (v: boolean) =>
                  v ? (
                    <span className="text-green-700">✓</span>
                  ) : (
                    <span className="text-red-600">✗</span>
                  );
                return (
                  <tr key={s.employee}>
                    <td className="font-medium">{s.employeeFull}</td>
                    <td>{yn(s.inList)}</td>
                    <td>{yn(s.inKk)}</td>
                    <td className="tabular-nums">{s.kkActiveClients}</td>
                    <td>{yn(s.inViolations)}</td>
                    <td className="tabular-nums">{s.violationCount}</td>
                    <td>{yn(s.inKpi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Выгрузка Artyom / TaxService / ArmSoft в приложенных файлах отдельным
          листом не представлена — источник в матрицу не добавлен, чтобы не
          показывать пустой столбец. Появится при наличии данных.
        </p>
      </section>

      {/* D. Нарушения */}
      <section>
        <h2 className="text-base font-semibold mb-2">
          D. Нарушения (исправленные, только валидные — {a.violations.length})
        </h2>
        <AuditViolationsTable
          violations={a.violations}
          employees={a.valid.map((e) => ({ short: e.short, full: e.canonical }))}
        />
      </section>

      {/* Проблемы и достижения */}
      {a.problems.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-2">
            Проблемы и достижения (из одноимённого листа)
          </h2>
          <div className="card overflow-x-auto">
            <table className="qa dense">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Клиент</th>
                  <th>Тип / причина</th>
                  <th>Сотрудник</th>
                  <th>Описание</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {a.problems.map((p, i) => (
                  <tr key={i}>
                    <td className="tabular-nums whitespace-nowrap">
                      {fmtDate(p.date)}
                    </td>
                    <td>{p.client ?? "—"}</td>
                    <td>{p.type ?? "—"}</td>
                    <td className={p.matched ? "" : "text-amber-600"}>
                      {p.employee}
                      {!p.matched && " (не сопоставлен)"}
                    </td>
                    <td className="max-w-[24rem]">{p.description ?? "—"}</td>
                    <td className="whitespace-nowrap">{p.status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
