"use client";

import { useMemo, useState } from "react";
import { VIOLATION_SEVERITIES, VIOLATION_TYPES } from "@/lib/violations";
import type { Chat, Violation } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

interface Draft {
  vdate: string;
  accountant: string;
  chat_agr_no: string;
  client: string;
  severity: string;
  violation_type: string;
  sanction: string;
  note: string;
}

function blankDraft(): Draft {
  return {
    vdate: today(),
    accountant: "",
    chat_agr_no: "",
    client: "",
    severity: "Критичное",
    violation_type: "",
    sanction: "",
    note: "",
  };
}

export default function ViolationsPanel({
  accountants,
  chats,
  initialViolations,
}: {
  accountants: string[];
  chats: Chat[];
  initialViolations: Violation[];
}) {
  const [rows, setRows] = useState<Violation[]>(initialViolations);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatMap = useMemo(() => new Map(chats.map((c) => [c.agr_no, c])), [chats]);

  function pickChat(agrNo: string) {
    const c = chatMap.get(agrNo);
    setDraft({
      ...draft,
      chat_agr_no: agrNo,
      client: c?.chat_name ?? draft.client,
      accountant: c?.accountant ?? draft.accountant,
    });
  }

  async function save() {
    if (!draft.severity && !draft.violation_type) {
      setError("Укажите тип нарушения");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/violations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vdate: draft.vdate,
          accountant: draft.accountant || null,
          chat_agr_no: draft.chat_agr_no || null,
          client: draft.client || null,
          severity: draft.severity || null,
          violation_type: draft.violation_type || null,
          sanction: draft.sanction || null,
          note: draft.note || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Не удалось сохранить");
        return;
      }
      const saved: Violation = await res.json();
      setRows((p) => [saved, ...p]);
      setDraft(blankDraft());
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-red-600 px-1">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Бухгалтер</th>
              <th className="min-w-[200px]">Клиент / Чат</th>
              <th>Тип (важность)</th>
              <th className="min-w-[200px]">Нарушение</th>
              <th>Санкция (драм)</th>
              <th className="min-w-[160px]">Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="whitespace-nowrap">{v.vdate}</td>
                <td>{v.accountant ?? "—"}</td>
                <td>
                  <div>{v.client ?? v.chat_agr_no ?? "—"}</div>
                  {v.chat_agr_no && (
                    <div className="text-xs text-gray-400">№ {v.chat_agr_no}</div>
                  )}
                </td>
                <td>
                  <span
                    className={
                      v.severity === "Критичное" || v.severity === "Грубое"
                        ? "text-red-600 font-medium"
                        : ""
                    }
                  >
                    {v.severity ?? "—"}
                  </span>
                </td>
                <td className="text-xs">{v.violation_type ?? "—"}</td>
                <td className="tabular-nums">{v.sanction ?? "—"}</td>
                <td className="text-xs text-gray-600">{v.note ?? ""}</td>
                <td></td>
              </tr>
            ))}
            {/* New row */}
            <tr className="bg-blue-50/40">
              <td>
                <input
                  type="date"
                  className="input w-[130px]"
                  value={draft.vdate}
                  onChange={(e) => setDraft({ ...draft, vdate: e.target.value })}
                />
              </td>
              <td>
                <select
                  className="input"
                  value={draft.accountant}
                  onChange={(e) => setDraft({ ...draft, accountant: e.target.value })}
                >
                  <option value="">—</option>
                  {accountants.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </td>
              <td className="space-y-1">
                <select
                  className="input w-full text-xs"
                  value={draft.chat_agr_no}
                  onChange={(e) => pickChat(e.target.value)}
                >
                  <option value="">— выбрать чат —</option>
                  {chats.map((c) => (
                    <option key={c.agr_no} value={c.agr_no}>
                      № {c.agr_no} — {c.chat_name}
                    </option>
                  ))}
                </select>
                <input
                  className="input w-full text-xs"
                  placeholder="или впишите клиента"
                  value={draft.client}
                  onChange={(e) => setDraft({ ...draft, client: e.target.value })}
                />
              </td>
              <td>
                <select
                  className="input"
                  value={draft.severity}
                  onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
                >
                  {VIOLATION_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  list="violation-types"
                  className="input w-full text-xs"
                  placeholder="тип нарушения"
                  value={draft.violation_type}
                  onChange={(e) => setDraft({ ...draft, violation_type: e.target.value })}
                />
                <datalist id="violation-types">
                  {VIOLATION_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </td>
              <td>
                <input
                  className="input w-[100px] tabular-nums"
                  inputMode="numeric"
                  placeholder="0"
                  value={draft.sanction}
                  onChange={(e) => setDraft({ ...draft, sanction: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="input w-full"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="примечание…"
                />
              </td>
              <td>
                <button className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? "…" : "Добавить"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
