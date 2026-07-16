"use client";

import { useMemo, useState } from "react";
import type { ViolationAppealView } from "@/lib/repo";

const STATUS_LABEL: Record<string, string> = {
  pending: "На рассмотрении",
  approved: "Принята",
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
  return isNaN(dt.getTime()) ? String(d).slice(0, 10) : dt.toLocaleDateString("ru-RU");
}

export default function ViolationAppealsPanel({
  initialAppeals,
}: {
  initialAppeals: ViolationAppealView[];
}) {
  const [appeals, setAppeals] = useState<ViolationAppealView[]>(initialAppeals);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [accountantFilter, setAccountantFilter] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accountants = useMemo(() => {
    const set = new Set<string>();
    for (const a of appeals) if (a.accountant) set.add(a.accountant);
    return [...set].sort();
  }, [appeals]);

  const counts = useMemo(
    () => ({
      pending: appeals.filter((a) => a.status === "pending").length,
      approved: appeals.filter((a) => a.status === "approved").length,
      rejected: appeals.filter((a) => a.status === "rejected").length,
      total: appeals.length,
    }),
    [appeals]
  );

  const visible = useMemo(() => {
    let list = appeals;
    if (statusFilter) list = list.filter((a) => a.status === statusFilter);
    if (accountantFilter) list = list.filter((a) => a.accountant === accountantFilter);
    if (from) list = list.filter((a) => (a.created_at || "").slice(0, 10) >= from);
    if (to) list = list.filter((a) => (a.created_at || "").slice(0, 10) <= to);
    return [...list].sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
  }, [appeals, statusFilter, accountantFilter, from, to]);

  async function decide(appeal: ViolationAppealView, decision: "approved" | "rejected") {
    if (decision === "rejected" && !confirm("Отклонить апелляцию? Нарушение и штраф останутся в силе.")) return;
    if (decision === "approved" && !confirm("Принять апелляцию? Штраф по нарушению будет снят.")) return;
    setBusy(appeal.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/violation-appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decision_comment: comments[appeal.id] ?? "" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Ошибка ${res.status}`);
      }
      const updated = await res.json();
      setAppeals((prev) =>
        prev.map((a) =>
          a.id === appeal.id
            ? { ...a, status: updated.status, resolved_by: updated.resolved_by, decision_comment: updated.decision_comment, resolved_at: updated.resolved_at }
            : a
        )
      );
      setNotice(
        `Апелляция ${decision === "approved" ? "принята" : "отклонена"}. Смотрите её в фильтре «${
          decision === "approved" ? "Принятые" : "Отклонённые"
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
      <div className="flex flex-wrap gap-3">
        <Stat value={counts.pending} label="Ожидают решения" alert={counts.pending > 0} />
        <Stat value={counts.approved} label="Принято" />
        <Stat value={counts.rejected} label="Отклонено" />
        <Stat value={counts.total} label="Всего" />
      </div>

      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Статус</span>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все</option>
            <option value="pending">На рассмотрении</option>
            <option value="approved">Принятые</option>
            <option value="rejected">Отклонённые</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">Бухгалтер</span>
          <select className="input" value={accountantFilter} onChange={(e) => setAccountantFilter(e.target.value)}>
            <option value="">Все</option>
            {accountants.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">С даты</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500 mb-1">По дату</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="btn-secondary"
          onClick={() => {
            setStatusFilter("");
            setAccountantFilter("");
            setFrom("");
            setTo("");
          }}
        >
          Сброс
        </button>
        <span className="text-xs text-gray-400">Показано: {visible.length}</span>
      </div>

      {error && <div className="card p-3 text-sm text-red-700 bg-red-50">{error}</div>}
      {notice && (
        <div className="card p-3 text-sm text-green-800 bg-green-50 border-green-200 flex items-start justify-between gap-3">
          <span>✓ {notice}</span>
          <button className="text-green-700 hover:text-green-900 shrink-0" onClick={() => setNotice(null)} aria-label="Закрыть">✕</button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-500">Апелляций по фильтру нет.</div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => {
            const v = a.violation;
            return (
              <div key={a.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium">
                      {a.accountant || "— бухгалтер не указан —"}
                    </div>
                    <div className="text-sm text-gray-500">
                      {v?.client || v?.chat_agr_no || "—"}
                      {v?.chat_agr_no && v?.client ? ` · № ${v.chat_agr_no}` : ""}
                      {" · нарушение от "}
                      {fmt(v?.vdate ?? null)}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${STATUS_CLASS[a.status] || "bg-gray-100"}`}>
                    {STATUS_LABEL[a.status] || a.status}
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-2 text-sm">
                  <Detail label="Категория">
                    {v?.severity ? `${v.severity}` : "—"}
                    {v?.violation_type ? ` · ${v.violation_type}` : ""}
                  </Detail>
                  <Detail label="Возможная санкция">
                    {v?.sanction != null ? `${v.sanction.toLocaleString("ru-RU")} ֏` : "предупреждение / по правилу"}
                  </Detail>
                  <Detail label="Комментарий Маргариты">{v?.note || "—"}</Detail>
                  <Detail label="Подана">{fmt(a.created_at)}</Detail>
                </div>

                <div className="text-sm bg-gray-50 rounded p-2">
                  <div className="text-gray-500 text-xs mb-1">Апелляция бухгалтера</div>
                  <div className="whitespace-pre-wrap">{a.appeal_text}</div>
                </div>

                {a.status !== "pending" ? (
                  <div className="text-sm text-gray-600">
                    Решение: <b>{STATUS_LABEL[a.status]}</b>
                    {a.resolved_at ? ` · ${fmt(a.resolved_at)}` : ""}
                    {a.resolved_by ? ` · ${a.resolved_by}` : ""}
                    {a.decision_comment ? ` — «${a.decision_comment}»` : ""}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      className="input w-full"
                      rows={2}
                      placeholder="Комментарий к решению (необязательно, желательно при отклонении)"
                      value={comments[a.id] ?? ""}
                      onChange={(e) => setComments((c) => ({ ...c, [a.id]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <button
                        className="btn bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        disabled={busy === a.id}
                        onClick={() => decide(a, "approved")}
                      >
                        {busy === a.id ? "…" : "Принять"}
                      </button>
                      <button
                        className="btn bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                        disabled={busy === a.id}
                        onClick={() => decide(a, "rejected")}
                      >
                        {busy === a.id ? "…" : "Отклонить"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div className={`card px-4 py-3 ${alert ? "ring-2 ring-amber-300" : ""}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-gray-500 text-xs">{label}: </span>
      <span>{children}</span>
    </div>
  );
}
