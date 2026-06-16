import SchemeCalculators from "@/components/SchemeCalculators";
import {
  BONUS_RULES,
  CRITICAL_ACCUMULATION,
  CRITICAL_ERROR_RULES,
  GRADE_LADDERS,
  STAR_RULES,
  fmtDram,
} from "@/lib/handbook";
import { SANCTION_CAP_PCT, SANCTION_RULES } from "@/lib/violations";
import { REGISTRATION_PENALTIES, SCHEMES } from "@/lib/scoring";

export const dynamic = "force-dynamic";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function HandbookPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Грейды и регламент</h1>
        <p className="text-sm text-gray-500">
          Все варианты оценки с баллами, грейды, бонусы и санкции — перенесены из
          таблиц Бухгалтерии и Регистрационного отдела.
        </p>
      </div>

      <Section
        title="Модели оценки"
        subtitle="Платформа поддерживает несколько схем — у каждой роли своя модель и свои баллы."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {SCHEMES.map((s) => (
            <div key={s.id} className="card p-3">
              <div className="font-medium text-gray-900">{s.name}</div>
              <div className="text-xs text-gray-400 mb-1">
                {s.department} · {s.subject}
              </div>
              <div className="text-xs text-gray-600">{s.description}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Калькуляторы оценки"
        subtitle="Посчитайте оценку менеджера или бухгалтера прямо здесь."
      >
        <SchemeCalculators />
      </Section>

      <Section
        title="Еженедельная оценка — Регистрационный отдел"
        subtitle="Старт 100 баллов, минус штрафы за каждый случай нарушения."
      >
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Стандарт</th>
                <th className="px-3 py-2 font-medium">Цель</th>
                <th className="px-3 py-2 font-medium text-center">Балл</th>
                <th className="px-3 py-2 font-medium">Последствие</th>
              </tr>
            </thead>
            <tbody>
              {REGISTRATION_PENALTIES.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    {p.name}
                    {p.critical && (
                      <span className="ml-1 text-[10px] text-red-600">крит.</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{p.goal}</td>
                  <td className="px-3 py-2 text-center tabular-nums font-medium">
                    {p.points}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{p.consequence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Грейды и оклады">
        <div className="grid gap-4 lg:grid-cols-2">
          {GRADE_LADDERS.map((ladder) => (
            <div key={ladder.department} className="card p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900">{ladder.department}</h3>
                <p className="text-xs text-gray-500">{ladder.review}</p>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="font-medium">Грейд</th>
                    <th className="font-medium text-right">Оклад</th>
                    <th className="font-medium text-right">Бонус</th>
                    <th className="font-medium text-right">Штраф</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.grades.map((g) => (
                    <tr key={g.name} className="border-t border-gray-100">
                      <td className="py-1.5">
                        {g.name}
                        {g.tenure && (
                          <span className="text-[11px] text-gray-400"> · {g.tenure}</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{fmtDram(g.salary)}</td>
                      <td className="text-right tabular-nums text-green-600">
                        {g.kpiBonus ? "+" + fmtDram(g.kpiBonus) : "—"}
                      </td>
                      <td className="text-right tabular-nums text-red-600">
                        {g.penalty ? fmtDram(g.penalty) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5">
                {ladder.basis.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Бонусы и поощрения">
        <div className="grid gap-3 md:grid-cols-3">
          {BONUS_RULES.map((b) => (
            <div key={b.name} className="card p-3 space-y-1">
              <div className="font-medium text-gray-900">{b.name}</div>
              <div className="text-sm text-blue-700 font-medium">{b.amount}</div>
              <div className="text-[11px] text-gray-400">{b.period}</div>
              <ul className="text-xs text-gray-600 list-disc pl-4 space-y-0.5">
                {b.conditions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="card p-3">
          <div className="font-medium text-gray-900 mb-2 text-sm">
            Система звёзд
          </div>
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            {STAR_RULES.map((s) => (
              <div key={s.name} className="rounded border border-gray-100 p-2">
                <div className="font-medium">⭐ {s.name}</div>
                <div className="text-xs text-gray-600">{s.reward}</div>
                <div className="text-[11px] text-gray-400">{s.condition}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Санкции"
        subtitle={`Общая сумма штрафов за месяц не может превышать ${SANCTION_CAP_PCT}% от оклада.`}
      >
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Нарушение</th>
                <th className="px-3 py-2 font-medium">Эскалация</th>
              </tr>
            </thead>
            <tbody>
              {SANCTION_RULES.map((r) => (
                <tr key={r.trigger} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2">
                    {r.trigger}
                    {r.note && (
                      <div className="text-[11px] text-gray-400 mt-0.5">{r.note}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ul className="list-disc pl-4 space-y-0.5 text-gray-600">
                      {r.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Критические ошибки — Регистрационный отдел"
        subtitle="Влияют на KPI-бонус (переменную часть), отдельно от еженедельного балла."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Ошибка</th>
                  <th className="px-3 py-2 font-medium text-right">Штраф</th>
                </tr>
              </thead>
              <tbody>
                {CRITICAL_ERROR_RULES.map((r) => (
                  <tr key={r.error} className="border-t border-gray-100">
                    <td className="px-3 py-2">{r.error}</td>
                    <td className="px-3 py-2 text-right text-red-600 whitespace-nowrap">
                      {r.penalty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">За месяц</th>
                  <th className="px-3 py-2 font-medium">Специалист I–II</th>
                  <th className="px-3 py-2 font-medium">Старший I–II</th>
                </tr>
              </thead>
              <tbody>
                {CRITICAL_ACCUMULATION.map((r) => (
                  <tr key={r.count} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{r.count}</td>
                    <td className="px-3 py-2 text-gray-600">{r.junior}</td>
                    <td className="px-3 py-2 text-gray-600">{r.senior}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}
