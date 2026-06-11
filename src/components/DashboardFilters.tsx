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

  return (
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
  );
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
