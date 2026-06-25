"use client";

import { useMemo, useState } from "react";
import {
  VIOLATION_SEVERITIES,
  violationTypeOptions,
} from "@/lib/violations";
import type { CriticalChat } from "@/lib/report";
import type { Chat, Violation } from "@/lib/types";

const TG_WINDOW = "telegram_chat";

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

function violationToDraft(v: Violation): Draft {
  return {
    vdate: v.vdate ?? today(),
    accountant: v.accountant ?? "",
    chat_agr_no: v.chat_agr_no ?? "",
    client: v.client ?? "",
    severity: v.severity ?? "Критичное",
    violation_type: v.violation_type ?? "",
    sanction: v.sanction != null ? String(v.sanction) : "",
    note: v.note ?? "",
  };
}

export default function ViolationsPanel({
  accountants,
  chats,
  initialViolations,
  criticalChats = [],
  criticalWindow,
}: {
  accountants: string[];
  chats: Chat[];
  initialViolations: Violation[];
  criticalChats?: CriticalChat[];
  criticalWindow?: { from: string; to: string };
}) {
  const [rows, setRows] = useState<Violation[]>(initialViolations);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing state: id → draft for inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const chatMap = useMemo(() => new Map(chats.map((c) => [c.agr_no, c])), [chats]);

  const loggedChatNos = useMemo(
    () => new Set(rows.map((v) => v.chat_agr_no).filter(Boolean) as string[]),
    [rows]
  );

  // Filters — default to today so the view shows current day by default
  const [fSeverity, setFSeverity] = useState("");
  const [fAccountant, setFAccountant] = useState("");
  const [fFrom, setFFrom] = useState(today());
  const [fTo, setFTo] = useState(today());
  const [showAllDates, setShowAllDates] = useState(false);

  const [importDate, setImportDate] = useState(today());
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function importCritical() {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/violations/import-critical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: importDate }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportMsg(d.error || "Не удалось импортировать");
        return;
      }
      setImportMsg(
        `Добавлено: ${d.created ?? 0}${d.skipped ? `, пропущено (уже есть): ${d.skipped}` : ""}`
      );
      const list = await fetch(`/api/violations?from=${importDate}&to=${importDate}`);
      if (list.ok) {
        const fresh: Violation[] = await list.json();
        setRows((prev) => {
          const ids = new Set(fresh.map((v) => v.id));
          return [...fresh, ...prev.filter((v) => !ids.has(v.id))];
        });
      }
    } catch {
      setImportMsg("Сетевая ошибка");
    } finally {
      setImporting(false);
    }
  }

  const filtered = useMemo(
    () =>
      rows.filter((v) => {
        if (fSeverity && v.severity !== fSeverity) return false;
        if (fAccountant && v.accountant !== fAccountant) return false;
        if (!showAllDates) {
          if (fFrom && (v.vdate ?? "") < fFrom) return false;
          if (fTo && (v.vdate ?? "") > fTo) return false;
        }
        return true;
      }),
    [rows, fSeverity, fAccountant, fFrom, fTo, showAllDates]
  );

  function pickChat(agrNo: string) {
    const c = chatMap.get(agrNo);
    setDraft({
      ...draft,
      chat_agr_no: agrNo,
      client: c?.chat_name ?? draft.client,
      accountant: c?.accountant ?? draft.accountant,
    });
  }

  function pickChatForEdit(agrNo: string) {
    const c = chatMap.get(agrNo);
    setEditDraft({
      ...editDraft,
      chat_agr_no: agrNo,
      client: c?.chat_name ?? editDraft.client,
      accountant: c?.accountant ?? editDraft.accountant,
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

  function startEdit(v: Violation) {
    setEditingId(v.id);
    setEditDraft(violationToDraft(v));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/violations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vdate: editDraft.vdate,
          accountant: editDraft.accountant || null,
          client: editDraft.client || null,
          severity: editDraft.severity || null,
          violation_type: editDraft.violation_type || null,
          sanction: editDraft.sanction === "" ? null : Number(editDraft.sanction),
          note: editDraft.note || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setEditError(d.error || "Не удалось сохранить");
        return;
      }
      const updated: Violation = await res.json();
      setRows((p) => p.map((v) => (v.id === id ? updated : v)));
      setEditingId(null);
    } catch {
      setEditError("Сетевая ошибка");
    } finally {
      setEditSaving(false);
    }
  }

  async function deleteRow(id: string) {
    if (!confirm("Удалить запись о нарушении?")) return;
    try {
      const res = await fetch(`/api/violations/${id}`, { method: "DELETE" });
      if (res.ok) setRows((p) => p.filter((v) => v.id !== id));
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <Field label="Важность">
          <select className="input" value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}>
            <option value="">Все</option>
            {VIOLATION_SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Бухгалтер">
          <select className="input" value={fAccountant} onChange={(e) => setFAccountant(e.target.value)}>
            <option value="">Все</option>
            {accountants.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </Field>
        {!showAllDates && (
          <>
            <Field label="С даты">
              <input type="date" className="input" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
            </Field>
            <Field label="По дату">
              <input type="date" className="input" value={fTo} onChange={(e) => setFTo(e.target.value)} />
            </Field>
          </>
        )}
        <div className="flex items-center gap-2 pb-1.5">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showAllDates}
              onChange={(e) => setShowAllDates(e.target.checked)}
            />
            Все даты
          </label>
        </div>
        <button
          className="btn-secondary"
          onClick={() => {
            setFSeverity("");
            setFAccountant("");
            setFFrom(today());
            setFTo(today());
            setShowAllDates(false);
          }}
        >
          Сброс
        </button>
        <span className="text-xs text-gray-400 pb-1.5">Показано: {filtered.length}</span>
      </div>

      {/* Auto-import critical chats */}
      <div className="card p-3 flex flex-wrap items-end gap-3 bg-amber-50/40">
        <Field label="Критичные чаты за дату">
          <input
            type="date"
            className="input"
            value={importDate}
            onChange={(e) => setImportDate(e.target.value)}
          />
        </Field>
        <button
          className="btn-primary"
          onClick={importCritical}
          disabled={importing}
          title="Добавить в журнал все чаты, получившие «Критично» в этот день. Повторный запуск не создаёт дублей."
        >
          {importing ? "Импорт…" : "➕ Импортировать критичные чаты"}
        </button>
        {importMsg && <span className="text-xs text-gray-600 pb-1.5">{importMsg}</span>}
      </div>

      {/* Critical chats from QA scoring */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 pb-1 flex items-baseline gap-2">
          <span className="text-sm font-medium">Критичные чаты по оценкам</span>
          {criticalWindow && (
            <span className="text-xs text-gray-400">
              {criticalWindow.from} — {criticalWindow.to}
            </span>
          )}
          <span className="text-xs text-gray-400">· {criticalChats.length}</span>
        </div>
        <table className="qa">
          <thead>
            <tr>
              <th className="min-w-[200px]">Клиент / Чат</th>
              <th>Бухгалтер</th>
              <th>Оценка</th>
              <th className="min-w-[200px]">Причина</th>
              <th>В журнале</th>
            </tr>
          </thead>
          <tbody>
            {criticalChats.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-6">
                  Нет критичных чатов за период.
                </td>
              </tr>
            )}
            {criticalChats.map((c) => {
              const chat = chatMap.get(c.chat_agr_no);
              const logged = loggedChatNos.has(c.chat_agr_no);
              return (
                <tr key={c.chat_agr_no} className={logged ? "" : "bg-red-50/50"}>
                  <td>
                    <div>{c.chat_name ?? c.chat_agr_no}</div>
                    <div className="text-xs text-gray-400">
                      № {c.chat_agr_no}
                      {chat?.chat_link && (
                        <> · <a href={chat.chat_link} target={TG_WINDOW} rel="noreferrer" className="text-blue-600 hover:underline">открыть</a></>
                      )}
                    </div>
                  </td>
                  <td>{c.accountant ?? "—"}</td>
                  <td className="tabular-nums text-red-600 font-medium">{c.score}</td>
                  <td className="text-xs text-gray-600">{c.reasons.join("; ") || "—"}</td>
                  <td className="whitespace-nowrap">
                    {logged ? (
                      <span className="text-green-600 text-xs">✓ в журнале</span>
                    ) : (
                      <span className="text-amber-600 text-xs font-medium">нет</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <div className="text-sm text-red-600 px-1">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="qa">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Бухгалтер</th>
              <th className="min-w-[200px]">Клиент / Чат</th>
              <th>Важность</th>
              <th className="min-w-[200px]">Нарушение</th>
              <th>Санкция</th>
              <th className="min-w-[160px]">Комментарий</th>
              <th>Действие</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const chat = v.chat_agr_no ? chatMap.get(v.chat_agr_no) : null;
              const isEditing = editingId === v.id;

              if (isEditing) {
                return (
                  <tr key={v.id} className="bg-blue-50/60">
                    <td>
                      <input
                        type="date"
                        className="input w-[130px]"
                        value={editDraft.vdate}
                        onChange={(e) => setEditDraft({ ...editDraft, vdate: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={editDraft.accountant}
                        onChange={(e) => setEditDraft({ ...editDraft, accountant: e.target.value })}
                      >
                        <option value="">—</option>
                        {accountants.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </td>
                    <td className="space-y-1">
                      <select
                        className="input w-full text-xs"
                        value={editDraft.chat_agr_no}
                        onChange={(e) => pickChatForEdit(e.target.value)}
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
                        value={editDraft.client}
                        onChange={(e) => setEditDraft({ ...editDraft, client: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={editDraft.severity}
                        onChange={(e) => setEditDraft({ ...editDraft, severity: e.target.value })}
                      >
                        {VIOLATION_SEVERITIES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        list="edit-violation-types"
                        className="input w-full text-xs"
                        value={editDraft.violation_type}
                        onChange={(e) => setEditDraft({ ...editDraft, violation_type: e.target.value })}
                      />
                      <datalist id="edit-violation-types">
                        {violationTypeOptions(editDraft.severity).map((t) => (
                          <option key={t} value={t} />
                        ))}
                      </datalist>
                    </td>
                    <td>
                      <input
                        className="input w-[90px] tabular-nums"
                        inputMode="numeric"
                        placeholder="0"
                        value={editDraft.sanction}
                        onChange={(e) => setEditDraft({ ...editDraft, sanction: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-full"
                        value={editDraft.note}
                        onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })}
                        placeholder="примечание…"
                      />
                    </td>
                    <td></td>
                    <td className="whitespace-nowrap space-x-1">
                      <button
                        className="btn-primary !py-1 !px-2 text-xs"
                        onClick={() => saveEdit(v.id)}
                        disabled={editSaving}
                      >
                        {editSaving ? "…" : "Сохранить"}
                      </button>
                      <button
                        className="btn-secondary !py-1 !px-2 text-xs"
                        onClick={cancelEdit}
                      >
                        Отмена
                      </button>
                      {editError && (
                        <div className="text-xs text-red-600 mt-1">{editError}</div>
                      )}
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={v.id}>
                  <td className="whitespace-nowrap">{v.vdate}</td>
                  <td>{v.accountant ?? "—"}</td>
                  <td>
                    <div>{v.client ?? v.chat_agr_no ?? "—"}</div>
                    {v.chat_agr_no && (
                      <div className="text-xs text-gray-400">
                        № {v.chat_agr_no}
                        {chat?.chat_link && (
                          <> · <a href={chat.chat_link} target={TG_WINDOW} rel="noreferrer" className="text-blue-600 hover:underline">открыть</a></>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        v.severity === "Критичное" || v.severity === "Грубое"
                          ? "text-red-600 font-medium"
                          : v.severity === "Среднее"
                          ? "text-amber-600"
                          : ""
                      }
                    >
                      {v.severity ?? "—"}
                    </span>
                  </td>
                  <td className="text-xs">{v.violation_type ?? "—"}</td>
                  <td className="tabular-nums">{v.sanction != null ? `${v.sanction} ֏` : "—"}</td>
                  <td className="text-xs text-gray-600">{v.note ?? ""}</td>
                  <td>
                    <span className="inline-block rounded bg-red-100 text-red-700 font-medium text-xs px-2 py-0.5 whitespace-nowrap">
                      🔴 Требует действия бухгалтера
                    </span>
                  </td>
                  <td className="whitespace-nowrap space-x-1">
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => startEdit(v)}
                    >
                      ✏️ Изменить
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:text-red-600 ml-2"
                      onClick={() => deleteRow(v.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
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
                    <option key={a} value={a}>{a}</option>
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
                    <option key={s} value={s}>{s}</option>
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
                  {violationTypeOptions(draft.severity).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </td>
              <td>
                <input
                  className="input w-[90px] tabular-nums"
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
              <td></td>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500 block">{label}</label>
      {children}
    </div>
  );
}
