"use client";

import { useEffect, useMemo, useState } from "react";
import type { Appeal } from "@/lib/appeals-data";

const STATUS_LABEL: Record<string, string> = {
  pending: "На рассмотрении",
  approved: "Одобрена",
  rejected: "Отклонена",
};
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("ru-RU");
}

export default function AppealsPanel({ initialAppeals }: { initialAppeals: Appeal[] }) {
  const [appeals, setAppeals] = useState<Appeal[]>(initialAppeals);
  // Re-sync when AutoRefresh streams fresh props (seeded once → resolved/new
  // appeals only showed after a full reload). Mirrors ScoringPanel.
  useEffect(() => {
    setAppeals(initialAppeals);
  }, [initialAppeals]);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [accountantFilter, setAccountantFilter] = useState<string>("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accountants = useMemo(() => {
    const set = new Set<string>();
    for (const a of appeals) if (a.accountant_name) set.add(a.accountant_name);
    return [...set].sort();
  }, [appeals]);

  const pendingCount = appeals.filter((a) => a.status === "pending").length;

  const visible = useMemo(() => {
    let list = appeals;
    if (statusFilter) list = list.filter((a) => a.status === statusFilter);
    if (accountantFilter) list = list.filter((a) => a.accountant_name === accountantFilter);
    return [...list].sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
  }, [appeals, statusFilter, accountantFilter]);

  async function decide(appeal: Appeal, decision: "approved" | "rejected") {
    setBusy(appeal.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, resolution_comment: comments[appeal.id] ?? "" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Ошибка ${res.status}`);
      }
      const updated = await res.json();
      setAppeals((prev) =>
        prev.map((a) =>
          a.id === appeal.id
            ? { ...a, status: updated.status, resolved_by: updated.resolved_by, resolution_comment: updated.resolution_comment, resolved_at: updated.resolved_at }
            : a
        )
      );
      // Подтверждение: при фильтре «На рассмотрении» карточка после решения
      // уходит из списка — без явного сообщения кажется, что «ничего не
      // произошло». Показываем, что решение сохранено (и где его найти).
      const who = appeal.problem_title || appeal.problem_id || "апелляция";
      setNotice(
        `Апелляция «${who}» — ${
          decision === "approved" ? "одобрена" : "отклонена"
        }. Она ушла из списка «На рассмотрении» — смотрите её в фильтре «${
          decision === "approved" ? "Одобрены" : "Отклонены"
        }» или «Все».`
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <div className={`card px-4 py-3 ${pendingCount > 0 ? "ring-2 ring-amber-300" : ""}`}>
          <div className="text-2xl font-semibold">{pendingCount}</div>
          <div className="text-xs text-gray-500">Ожидают решения</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-2xl font-semibold">
            {appeals.filter((a) => a.status === "approved").length}
          </div>
          <div className="text-xs text-gray-500">Одобрено</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-2xl font-semibold">
            {appeals.filter((a) => a.status === "rejected").length}
          </div>
          <div className="text-xs text-gray-500">Отклонено</div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-2xl font-semibold">{appeals.length}</div>
          <div className="text-xs text-gray-500">Всего</div>
        </div>
      </div>

      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Статус</span>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все</option>
            <option value="pending">На рассмотрении</option>
            <option value="approved">Одобрены</option>
            <option value="rejected">Отклонены</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Бухгалтер</span>
          <select className="input" value={accountantFilter} onChange={(e) => setAccountantFilter(e.target.value)}>
            <option value="">Все</option>
            {accountants.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="card p-3 text-sm text-red-700 bg-red-50">{error}</div>}

      {notice && (
        <div className="card p-3 text-sm text-green-800 bg-green-50 border-green-200 flex items-start justify-between gap-3">
          <span>✓ {notice}</span>
          <button
            className="text-green-700 hover:text-green-900 shrink-0"
            onClick={() => setNotice(null)}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-500">Апелляций по фильтру нет.</div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <div key={a.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium">{a.problem_title || a.problem_id}</div>
                  <div className="text-sm text-gray-500">
                    {a.accountant_name || "—"}
                    {a.client_name ? ` · ${a.client_name}` : ""}
                    {" · "}
                    {fmt(a.created_at)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${STATUS_CLASS[a.status] || "bg-gray-100"}`}>
                  {STATUS_LABEL[a.status] || a.status}
                </span>
              </div>

              {a.chat_link && (
                <a className="text-sm text-blue-600" href={a.chat_link} target="_blank" rel="noreferrer">
                  Открыть чат ↗
                </a>
              )}

              <div className="text-sm bg-gray-50 rounded p-2">
                <div className="text-gray-500 text-xs mb-1">Апелляция бухгалтера</div>
                <div className="whitespace-pre-wrap">{a.comment}</div>
              </div>

              {a.status !== "pending" ? (
                <div className="text-sm text-gray-600">
                  Решение: <b>{STATUS_LABEL[a.status]}</b>
                  {a.resolution_comment ? ` — «${a.resolution_comment}»` : ""}
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    className="input w-full"
                    rows={2}
                    placeholder="Комментарий к решению (необязательно)"
                    value={comments[a.id] ?? ""}
                    onChange={(e) => setComments((c) => ({ ...c, [a.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn bg-green-600 text-white hover:bg-green-700"
                      disabled={busy === a.id}
                      onClick={() => decide(a, "approved")}
                    >
                      Одобрить
                    </button>
                    <button
                      className="btn bg-amber-500 text-white hover:bg-amber-600"
                      disabled={busy === a.id}
                      onClick={() => decide(a, "rejected")}
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
