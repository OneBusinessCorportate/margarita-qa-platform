import { buildEmployeeAudit } from "@/lib/employee-audit";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

/**
 * Компактная сводка аудита сотрудников. Только действующие сотрудники из
 * утверждённого списка; нарушения, штрафы и бонусы пересчитаны из приложенных
 * файлов (см. employee-audit.ts). Отдельной страницы «Аудит сотрудников» нет —
 * это единственное место, где живёт сводка.
 */
export default function EmployeeAuditSummary() {
  const a = buildEmployeeAudit();
  const drams = (n: number) => `${n.toLocaleString("ru-RU")} др.`;

  const stats: { label: string; value: string | number }[] = [
    { label: "Всего валидных", value: a.totals.validCount },
    { label: "Отсутствуют где-то", value: a.totals.missingCount },
    { label: "Невалидных найдено", value: a.totals.invalidCount },
    { label: "Нарушений (исправл.)", value: a.totals.violationCount },
    { label: "Штрафы, всего", value: drams(a.totals.penaltiesTotal) },
    { label: "Бонусов", value: a.totals.bonusCount },
    { label: "Ручная проверка", value: a.totals.reviewCount },
  ];

  return (
    <section className="card p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold">Аудит сотрудников</h2>
        <p className="text-sm text-gray-500">
          Только действующие сотрудники из утверждённого списка. Нарушения,
          штрафы и бонусы пересчитаны из приложенных файлов (
          {a.meta.violationSource}
          {" · "}
          {a.meta.kkSource}). Период нарушений: {fmtDate(a.meta.dateFrom)} —{" "}
          {fmtDate(a.meta.dateTo)}.
        </p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs text-gray-500">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-gray-900">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      {a.totals.droppedViolations > 0 && (
        <p className="text-xs text-gray-500">
          Из исходных {a.meta.violationCount} строк нарушений отброшено{" "}
          {a.totals.droppedViolations} — записаны на невалидных, пустых или
          неоднозначных сотрудников.
        </p>
      )}
    </section>
  );
}
