"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Filters {
  from?: string;
  to?: string;
  accountant?: string;
  client?: string;
}

export default function DashboardFilters({
  accountants,
  initial,
}: {
  accountants: string[];
  initial: Filters;
}) {
  const router = useRouter();
  const [f, setF] = useState<Filters>(initial);

  function apply(next: Filters) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.accountant) params.set("accountant", next.accountant);
    if (next.client) params.set("client", next.client);
    router.push(`/dashboard?${params.toString()}`);
  }

  // Apply a date range while keeping the accountant / client filters.
  function applyRange(from: string, to: string) {
    const next = { ...f, from, to };
    setF(next);
    apply(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {datePresets().map((p) => (
          <button
            key={p.label}
            className="btn-secondary text-xs"
            onClick={() => applyRange(p.from, p.to)}
            title={`${p.from} — ${p.to}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="card p-3 flex flex-wrap items-end gap-3">
      <Field label="С даты">
        <input
          type="date"
          className="input"
          value={f.from ?? ""}
          onChange={(e) => setF({ ...f, from: e.target.value })}
        />
      </Field>
      <Field label="По дату">
        <input
          type="date"
          className="input"
          value={f.to ?? ""}
          onChange={(e) => setF({ ...f, to: e.target.value })}
        />
      </Field>
      <Field label="Бухгалтер">
        <select
          className="input"
          value={f.accountant ?? ""}
          onChange={(e) => setF({ ...f, accountant: e.target.value })}
        >
          <option value="">Все</option>
          {accountants.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Клиент (№ / название)">
        <input
          className="input"
          placeholder="напр. 59 или ARM"
          value={f.client ?? ""}
          onChange={(e) => setF({ ...f, client: e.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => apply(f)}>
          Применить
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setF({});
            apply({});
          }}
        >
          Сброс
        </button>
      </div>
      </div>
    </div>
  );
}

// Quick date ranges (ISO yyyy-mm-dd, local time). "Previous" = the whole prior
// day / week (Mon–Sun) / calendar month; current = so far this week / month.
function datePresets(): { label: string; from: string; to: string }[] {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (d: Date, days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  };
  // Monday of the week containing `d`.
  const monday = (d: Date) => add(d, -((d.getDay() + 6) % 7));

  const yesterday = add(today, -1);
  const thisMonStart = monday(today);
  const lastMonStart = add(thisMonStart, -7);
  const lastMonEnd = add(thisMonStart, -1);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  return [
    { label: "Сегодня", from: iso(today), to: iso(today) },
    { label: "Вчера", from: iso(yesterday), to: iso(yesterday) },
    { label: "Эта неделя", from: iso(thisMonStart), to: iso(today) },
    { label: "Прошлая неделя", from: iso(lastMonStart), to: iso(lastMonEnd) },
    { label: "Этот месяц", from: iso(thisMonthStart), to: iso(today) },
    { label: "Прошлый месяц", from: iso(lastMonthStart), to: iso(lastMonthEnd) },
  ];
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500 block">{label}</label>
      {children}
    </div>
  );
}
