"use client";

import { useState } from "react";
import {
  KK_CRITERIA,
  KPI_CRITERIA,
  REGISTRATION_PENALTIES,
  REGISTRATION_START,
  computeKkScore,
  computeKpiScore,
  computeRegistrationScore,
  kkLevel,
  kpiBonusEligible,
} from "@/lib/scoring";
import BandChip from "./BandChip";

/**
 * Live calculators for the extra schemes so Margarita can compute a manager's
 * weekly registration score, a bookkeeper's monthly KPI, or a quality-control
 * (Контроль качества) assessment right in the app.
 */
export default function SchemeCalculators() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <RegistrationCalculator />
      <KpiCalculator />
      <KkCalculator />
    </div>
  );
}

function KkCalculator() {
  const [values, setValues] = useState<Record<string, number>>({});
  const total = computeKkScore(values);
  // An untouched form isn't a score of 0 — wait for at least one input.
  const hasInput = Object.values(values).some((v) => v > 0);
  const level = kkLevel(total);
  const set = (id: string, v: string) =>
    setValues((c) => ({
      ...c,
      [id]: v === "" ? 0 : Math.max(0, Math.min(100, Number(v))),
    }));

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-gray-900">
          Калькулятор — Контроль качества
        </h3>
        <p className="text-xs text-gray-500">
          Ежемесячная оценка бухгалтера: Итог = Σ(критерий × вес), 0–100.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="font-medium">Критерий</th>
            <th className="font-medium text-center">Вес</th>
            <th className="font-medium text-center">%</th>
          </tr>
        </thead>
        <tbody>
          {KK_CRITERIA.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="py-1.5">{c.name}</td>
              <td className="text-center tabular-nums text-gray-600">{c.weight}%</td>
              <td className="text-center">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-[64px] text-center"
                  value={values[c.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => set(c.id, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-gray-200 pt-3">
        <span className="text-sm text-gray-500">Итоговая оценка</span>
        <span className="flex items-center gap-2">
          {hasInput ? (
            <>
              <span className="text-2xl font-semibold tabular-nums">{total}</span>
              <BandChip total={total} />
            </>
          ) : (
            <span className="text-2xl font-semibold tabular-nums text-gray-300">—</span>
          )}
        </span>
      </div>
      <div className={`text-xs font-medium ${hasInput ? "text-gray-600" : "text-gray-400"}`}>
        Уровень: {level.action}
      </div>
    </div>
  );
}

function RegistrationCalculator() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const total = computeRegistrationScore(counts);
  const set = (id: string, v: string) =>
    setCounts((c) => ({ ...c, [id]: v === "" ? 0 : Math.max(0, Number(v)) }));

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-gray-900">
          Калькулятор — Регистрационный отдел
        </h3>
        <p className="text-xs text-gray-500">
          Старт {REGISTRATION_START} баллов, минус штрафы за нарушения недели.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="font-medium">Нарушение</th>
            <th className="font-medium text-center">Балл</th>
            <th className="font-medium text-center">Кол-во</th>
          </tr>
        </thead>
        <tbody>
          {REGISTRATION_PENALTIES.map((p) => (
            <tr key={p.id} className="border-t border-gray-100">
              <td className="py-1.5">
                {p.name}
                {p.critical && (
                  <span className="ml-1 text-[10px] text-red-600">крит.</span>
                )}
                <div className="text-[11px] text-gray-400">цель: {p.goal}</div>
              </td>
              <td className="text-center tabular-nums text-gray-600">{p.points}</td>
              <td className="text-center">
                <input
                  type="number"
                  min={0}
                  className="input w-[60px] text-center"
                  value={counts[p.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => set(p.id, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-gray-200 pt-3">
        <span className="text-sm text-gray-500">Итоговая оценка</span>
        <span className="flex items-center gap-2">
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <BandChip total={total} />
        </span>
      </div>
    </div>
  );
}

function KpiCalculator() {
  const [values, setValues] = useState<Record<string, number>>({});
  const total = computeKpiScore(values);
  const eligible = kpiBonusEligible(values);
  // An untouched form isn't a score of 0 — don't show a red "Критично" until at
  // least one indicator is entered. (KPI starts at 0, unlike the 100-based
  // registration model, so the empty state would otherwise look like a fail.)
  const hasInput = Object.values(values).some((v) => v > 0);
  const set = (id: string, v: string) =>
    setValues((c) => ({
      ...c,
      [id]: v === "" ? 0 : Math.max(0, Math.min(100, Number(v))),
    }));

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-gray-900">
          Калькулятор — KPI Бухгалтерии
        </h3>
        <p className="text-xs text-gray-500">
          Итого = Уведомл.×30% + CSAT×40% + Чаты/Сервис×30%.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="font-medium">Показатель</th>
            <th className="font-medium text-center">Вес</th>
            <th className="font-medium text-center">%</th>
          </tr>
        </thead>
        <tbody>
          {KPI_CRITERIA.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              <td className="py-1.5">{c.name}</td>
              <td className="text-center tabular-nums text-gray-600">{c.weight}%</td>
              <td className="text-center">
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input w-[64px] text-center"
                  value={values[c.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => set(c.id, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-gray-200 pt-3">
        <span className="text-sm text-gray-500">Итоговая оценка</span>
        <span className="flex items-center gap-2">
          {hasInput ? (
            <>
              <span className="text-2xl font-semibold tabular-nums">{total}</span>
              <BandChip total={total} />
            </>
          ) : (
            <span className="text-2xl font-semibold tabular-nums text-gray-300">—</span>
          )}
        </span>
      </div>
      <div
        className={`text-xs font-medium ${
          hasInput && eligible ? "text-green-600" : "text-gray-400"
        }`}
      >
        {eligible
          ? "✓ Квалифицируется на квартальный бонус 10%"
          : "Бонус 10%: нужно Чаты/Сервис ≥ 90, уведомления 100%, CSAT ≥ 80"}
      </div>
    </div>
  );
}
