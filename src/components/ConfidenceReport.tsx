"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfidenceReport } from "@/lib/confidence-report";
import { periodRange, type PeriodPreset } from "@/lib/confidence";

// ---------------------------------------------------------------------------
// Отчёт «Уверенность модели ↔ исправления Маргариты». Полностью клиентский:
// хранит фильтры, тянет /api/confidence-report при их изменении и рендерит
// карточки, таблицу по диапазонам, два графика (SVG, без библиотек — в проекте
// их нет) и блок корреляции. Реализованы состояния загрузки / пусто / ошибка.
// ---------------------------------------------------------------------------

interface Props {
  accountants: string[];
  categories: { id: string; name: string }[];
}

interface Filters {
  from: string;
  to: string;
  accountant: string;
  chat: string;
  category: string;
  confidenceRange: string;
  status: string;
  matchStatus: string;
}

const MATCH_OPTIONS = [
  { id: "exact", label: "Точное совпадение" },
  { id: "partial", label: "Частичное совпадение" },
  { id: "mismatch", label: "Несовпадение" },
];

const RANGE_OPTIONS = [
  { id: "0-49", label: "0–49%" },
  { id: "50-69", label: "50–69%" },
  { id: "70-79", label: "70–79%" },
  { id: "80-89", label: "80–89%" },
  { id: "90-94", label: "90–94%" },
  { id: "95-100", label: "95–100%" },
];

const STATUS_OPTIONS = [
  { id: "accepted", label: "Принято без изменений" },
  { id: "corrected", label: "Исправлено Маргаритой" },
  { id: "not_reviewed", label: "Не активно" },
];

function emptyFilters(): Filters {
  const { from, to } = periodRange("month");
  return {
    from: from ?? "",
    to: to ?? "",
    accountant: "",
    chat: "",
    category: "",
    confidenceRange: "",
    status: "",
    matchStatus: "",
  };
}

function fmtNum(n: number | null | undefined, suffix = ""): string {
  if (n == null) return "Нет данных";
  return `${n}${suffix}`;
}

export default function ConfidenceReportView({ accountants, categories }: Props) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [report, setReport] = useState<ConfidenceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Filters) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    if (f.accountant) params.set("accountant", f.accountant);
    if (f.chat) params.set("chat", f.chat.trim());
    if (f.category) params.set("category", f.category);
    if (f.confidenceRange) params.set("confidenceRange", f.confidenceRange);
    if (f.status) params.set("status", f.status);
    if (f.matchStatus) params.set("matchStatus", f.matchStatus);
    try {
      const res = await fetch(`/api/confidence-report?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Ошибка ${res.status}`);
      }
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить отчёт");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Первичная загрузка.
  useEffect(() => {
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(preset: PeriodPreset) {
    const { from, to } = periodRange(preset);
    const next = { ...filters, from: from ?? "", to: to ?? "" };
    setFilters(next);
    void load(next);
  }

  function apply() {
    void load(filters);
  }

  function reset() {
    const next = emptyFilters();
    setFilters(next);
    void load(next);
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Уверенность модели</h1>
        <p className="text-sm text-gray-500">
          Насколько надёжны AI-оценки чатов и связана ли высокая уверенность с
          редкими исправлениями Маргариты. Периоды считаются по времени Ереван.
        </p>
      </div>

      <Filters
        filters={filters}
        accountants={accountants}
        categories={categories}
        onSet={set}
        onApply={apply}
        onReset={reset}
        onPreset={applyPreset}
      />

      {loading && <StateCard>Загрузка…</StateCard>}
      {!loading && error && (
        <StateCard tone="error">Ошибка: {error}</StateCard>
      )}
      {!loading && !error && report && report.total === 0 && (
        <StateCard>Нет AI-оценок за выбранный период и фильтры.</StateCard>
      )}
      {!loading && !error && report && report.total > 0 && (
        <Report report={report} />
      )}
    </div>
  );
}

function StateCard({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      className={`card p-8 text-center text-sm ${
        tone === "error" ? "text-red-600" : "text-gray-500"
      }`}
    >
      {children}
    </div>
  );
}

function Filters({
  filters,
  accountants,
  categories,
  onSet,
  onApply,
  onReset,
  onPreset,
}: {
  filters: Filters;
  accountants: string[];
  categories: { id: string; name: string }[];
  onSet: (patch: Partial<Filters>) => void;
  onApply: () => void;
  onReset: () => void;
  onPreset: (p: PeriodPreset) => void;
}) {
  const presets: { id: PeriodPreset; label: string }[] = [
    { id: "today", label: "Сегодня" },
    { id: "yesterday", label: "Вчера" },
    { id: "week", label: "Текущая неделя" },
    { id: "month", label: "Текущий месяц" },
  ];
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            className="btn-secondary !px-2 !py-1 text-xs"
            onClick={() => onPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          С
          <input
            type="date"
            className="input block"
            value={filters.from}
            onChange={(e) => onSet({ from: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-600">
          По
          <input
            type="date"
            className="input block"
            value={filters.to}
            onChange={(e) => onSet({ to: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-600">
          Бухгалтер
          <select
            className="input block"
            value={filters.accountant}
            onChange={(e) => onSet({ accountant: e.target.value })}
          >
            <option value="">Все</option>
            {accountants.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Чат / клиент (№)
          <input
            type="text"
            className="input block"
            placeholder="напр. B-4809"
            value={filters.chat}
            onChange={(e) => onSet({ chat: e.target.value })}
          />
        </label>
        <label className="text-xs text-gray-600">
          Категория
          <select
            className="input block"
            value={filters.category}
            onChange={(e) => onSet({ category: e.target.value })}
          >
            <option value="">Все</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Диапазон уверенности
          <select
            className="input block"
            value={filters.confidenceRange}
            onChange={(e) => onSet({ confidenceRange: e.target.value })}
          >
            <option value="">Все</option>
            {RANGE_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Статус
          <select
            className="input block"
            value={filters.status}
            onChange={(e) => onSet({ status: e.target.value })}
          >
            <option value="">Все</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Совпадение
          <select
            className="input block"
            value={filters.matchStatus}
            onChange={(e) => onSet({ matchStatus: e.target.value })}
          >
            <option value="">Все</option>
            {MATCH_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button className="btn-primary !px-3 !py-1 text-xs" onClick={onApply}>
            Применить
          </button>
          <button className="btn-secondary !px-3 !py-1 text-xs" onClick={onReset}>
            Сброс
          </button>
        </div>
      </div>
    </div>
  );
}

function Report({ report }: { report: ConfidenceReport }) {
  return (
    <div className="space-y-6">
      <CalibrationHighlights report={report} />
      <SummaryCards report={report} />
      <MatchCards report={report} />
      <RangeTable report={report} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CorrectionByRangeChart report={report} />
        <AcceptedVsCorrectedChart report={report} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Correlation report={report} />
        <CorrelationScoreDiff report={report} />
      </div>
      <AccountantTable report={report} />
      <DetailedTable report={report} />
    </div>
  );
}

function MatchCards({ report: r }: { report: ConfidenceReport }) {
  const m = r.matches;
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">
        Совпадения AI ↔ Маргарита{" "}
        <span className="font-normal text-gray-400">
          (сравнимо {m.comparable}
          {m.excludedNoBaseline > 0 && `; исключено без AI-снимка: ${m.excludedNoBaseline}`})
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Точное совпадение (exact)" value={String(m.exact)} sub={fmtNum(m.exactPct, "%")} color="#059669" />
        <Card title="Частичное (partial)" value={String(m.partial)} sub="±5 баллов / правка критерия" color="#2563eb" />
        <Card title="Несовпадение (mismatch)" value={String(m.mismatch)} sub={fmtNum(m.mismatchPct, "%")} color="#dc2626" />
        <Card title="Приемлемо (exact+partial)" value={fmtNum(m.acceptablePct, "%")} sub="доля от сравнимых" color="#059669" />
        <Card title="Средняя разница баллов" value={m.avgScoreDiff == null ? "Нет данных" : String(m.avgScoreDiff)} sub={`|разница| ${fmtNum(m.avgAbsScoreDiff)}`} />
        <Card title="Медиана разницы баллов" value={m.medianScoreDiff == null ? "Нет данных" : String(m.medianScoreDiff)} />
        <Card title="Ср. уверенность — совпало" value={fmtNum(m.avgConfidenceMatched, "%")} color="#059669" />
        <Card title="Ср. уверенность — несовпало" value={fmtNum(m.avgConfidenceMismatched, "%")} color="#dc2626" />
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  sub,
  color = "#1f2937",
}: {
  title: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function SummaryCards({ report: r }: { report: ConfidenceReport }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="Всего AI-оценок" value={String(r.total)} sub={`${r.withConfidence} с уверенностью · ${r.noConfidence} без данных`} />
      <Card
        title="Принято без изменений"
        value={String(r.accepted)}
        sub={`${r.acceptedPct}% от всех`}
        color="#059669"
      />
      <Card
        title="Исправлено Маргаритой"
        value={String(r.corrected)}
        sub={`${r.correctedPct}% от всех`}
        color="#d97706"
      />
      <Card
        title="Не активно"
        value={String(r.notReviewed)}
        sub={`${r.notReviewedPct}% от всех`}
        color="#6b7280"
      />
      <Card
        title="Процент исправлений"
        value={fmtNum(r.overallCorrectionPct, "%")}
        sub="исправлено / проверено"
        color="#d97706"
      />
      <Card
        title="Средняя уверенность — принятые"
        value={fmtNum(r.avgConfidenceAccepted, "%")}
        color="#059669"
      />
      <Card
        title="Средняя уверенность — исправленные"
        value={fmtNum(r.avgConfidenceCorrected, "%")}
        color="#d97706"
      />
      <Card
        title="Оценок с уверенностью ≥90%"
        value={String(r.high.count)}
        sub={r.high.pct == null ? "Нет данных" : `${r.high.pct}% · исправлено ${r.high.corrected}`}
        color="#2563eb"
      />
    </div>
  );
}

function CalibrationHighlights({ report: r }: { report: ConfidenceReport }) {
  return (
    <div className="space-y-3">
      {/* Цель калибровки (п.6). */}
      <div className="card p-4 bg-gradient-to-br from-sky-50 to-emerald-50 border-sky-200">
        <div className="text-sm font-semibold text-gray-800">
          🎯 Цель: откалибровать систему QA-анализа
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Уверенность модели должна отражать реальность: там, где модель уверена
          (≥90%), Маргарите почти не нужно исправлять оценку, а там, где не уверена
          (&lt;90%), исправления должны быть частыми. Два показателя ниже — это
          «ошибки калибровки»: чем они меньше, тем ближе автоматические оценки к
          оценкам Маргариты.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Основной показатель 1 (п.3): исправлено из уверенности ≥90%. */}
        <div className="card p-6 bg-gradient-to-br from-amber-50 to-white border-amber-200">
          <div className="text-sm font-medium text-gray-600">
            Показатель 1 — исправлено при уверенности{" "}
            <span className="font-semibold">≥90%</span>
          </div>
          <div className="text-xs text-gray-500">
            модель была уверена, но Маргарита всё равно поправила — переоценка
            уверенности
          </div>
          <div className="text-5xl font-bold tabular-nums text-amber-700 mt-2">
            {r.high.corrected}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            исправлено{" "}
            {r.high.reviewed > 0 && (
              <span className="text-gray-400">
                ({fmtNum(r.high.correctedPct, "%")} от проверенных ≥90%)
              </span>
            )}
          </div>
          <div className="mt-3 border-t pt-2 text-sm text-gray-500">
            Всего оценок с уверенностью ≥90%:{" "}
            <span className="font-semibold tabular-nums text-gray-700">
              {r.high.count}
            </span>{" "}
            <span className="text-gray-400">(проверено {r.high.reviewed})</span>
          </div>
        </div>

        {/* Основной показатель 2 (п.4): НЕ исправлено из уверенности <90%. */}
        <div className="card p-6 bg-gradient-to-br from-blue-50 to-white border-blue-200">
          <div className="text-sm font-medium text-gray-600">
            Показатель 2 — НЕ исправлено при уверенности{" "}
            <span className="font-semibold">&lt;90%</span>
          </div>
          <div className="text-xs text-gray-500">
            модель была не уверена, но оценка оказалась верной — заниженная
            уверенность
          </div>
          <div className="text-5xl font-bold tabular-nums text-blue-700 mt-2">
            {r.low.accepted}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            принято без изменений{" "}
            {r.low.reviewed > 0 && (
              <span className="text-gray-400">
                ({fmtNum(r.low.notCorrectedPct, "%")} от проверенных &lt;90%)
              </span>
            )}
          </div>
          <div className="mt-3 border-t pt-2 text-sm text-gray-500">
            Всего оценок с уверенностью &lt;90%:{" "}
            <span className="font-semibold tabular-nums text-gray-700">
              {r.low.count}
            </span>{" "}
            <span className="text-gray-400">(проверено {r.low.reviewed})</span>
          </div>
        </div>
      </div>

      {/* Показатель 5: чаты с отклонением оценки <5% между Маргаритой и AI. */}
      <div className="card p-6 bg-gradient-to-br from-emerald-50 to-white border-emerald-200">
        <div className="text-sm font-medium text-gray-600">
          Согласие оценок: чаты с отклонением{" "}
          <span className="font-semibold">&lt;5%</span> между Маргаритой и AI
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-2">
          <span className="text-5xl font-bold tabular-nums text-emerald-700">
            {r.closeAgreement.count}
          </span>
          <span className="text-3xl font-semibold tabular-nums text-emerald-600">
            {r.closeAgreement.pct == null ? "" : `${r.closeAgreement.pct}%`}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Из {r.closeAgreement.comparable} сравнимых чатов (проверено, есть
          AI-снимок) итоговая оценка Маргариты и AI расходится менее чем на 5
          баллов из 100.
          {r.closeAgreement.comparable === 0 &&
            " Нет сравнимых чатов в выборке."}
        </div>
      </div>
    </div>
  );
}

function RangeTable({ report: r }: { report: ConfidenceReport }) {
  return (
    <div className="card overflow-x-auto">
      <div className="p-3 font-semibold text-sm">По диапазонам уверенности</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="px-3 py-2">Диапазон</th>
            <th className="px-3 py-2 text-right">Всего</th>
            <th className="px-3 py-2 text-right" title="Точное совпадение">Совп.</th>
            <th className="px-3 py-2 text-right" title="Частичное совпадение">Частич.</th>
            <th className="px-3 py-2 text-right" title="Несовпадение">Несовп.</th>
            <th className="px-3 py-2 text-right">Принято</th>
            <th className="px-3 py-2 text-right">Исправлено</th>
            <th className="px-3 py-2 text-right">Не акт.</th>
            <th className="px-3 py-2 text-right">% исправлений</th>
            <th className="px-3 py-2 text-right" title="Средний модуль разницы баллов">Ср. Δ</th>
          </tr>
        </thead>
        <tbody>
          {r.ranges.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{row.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.total}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{row.exact}</td>
              <td className="px-3 py-2 text-right tabular-nums text-blue-700">{row.partial}</td>
              <td className="px-3 py-2 text-right tabular-nums text-red-700">{row.mismatch}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{row.accepted}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-700">{row.corrected}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-400">{row.notReviewed}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">
                {row.correctionPct == null ? "—" : `${row.correctionPct}%`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.avgScoreDiff == null ? "—" : row.avgScoreDiff}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="px-3 py-2">Итого</td>
            <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.matches.exact}</td>
            <td className="px-3 py-2 text-right tabular-nums text-blue-700">{r.matches.partial}</td>
            <td className="px-3 py-2 text-right tabular-nums text-red-700">{r.matches.mismatch}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{r.accepted}</td>
            <td className="px-3 py-2 text-right tabular-nums text-amber-700">{r.corrected}</td>
            <td className="px-3 py-2 text-right tabular-nums text-gray-400">{r.notReviewed}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {r.overallCorrectionPct == null ? "—" : `${r.overallCorrectionPct}%`}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {r.matches.avgAbsScoreDiff == null ? "—" : r.matches.avgAbsScoreDiff}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// --- Графики (SVG) ----------------------------------------------------------

function CorrectionByRangeChart({ report: r }: { report: ConfidenceReport }) {
  const W = 460;
  const H = 240;
  const padL = 36;
  const padB = 40;
  const padT = 12;
  const bars = r.ranges;
  const bw = (W - padL - 10) / bars.length;
  return (
    <div className="card p-4">
      <div className="font-semibold text-sm mb-2">Процент исправлений по диапазонам</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Процент исправлений по диапазонам уверенности">
        {[0, 25, 50, 75, 100].map((g) => {
          const y = padT + (H - padT - padB) * (1 - g / 100);
          return (
            <g key={g}>
              <line x1={padL} y1={y} x2={W - 4} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} fontSize={9} fill="#9ca3af" textAnchor="end">{g}</text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const x = padL + i * bw + bw * 0.15;
          const w = bw * 0.7;
          const pctVal = b.correctionPct;
          const h = pctVal == null ? 0 : (H - padT - padB) * (pctVal / 100);
          const y = padT + (H - padT - padB) - h;
          return (
            <g key={b.id}>
              {pctVal != null && (
                <>
                  <rect x={x} y={y} width={w} height={h} rx={2} fill="#d97706" />
                  <text x={x + w / 2} y={y - 3} fontSize={9} fill="#92400e" textAnchor="middle">
                    {pctVal}%
                  </text>
                </>
              )}
              {pctVal == null && (
                <text x={x + w / 2} y={H - padB - 4} fontSize={8} fill="#d1d5db" textAnchor="middle">н/д</text>
              )}
              <text x={x + w / 2} y={H - padB + 12} fontSize={8} fill="#6b7280" textAnchor="middle">
                {b.label}
              </text>
              <text x={x + w / 2} y={H - padB + 23} fontSize={8} fill="#9ca3af" textAnchor="middle">
                n={b.reviewed}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AcceptedVsCorrectedChart({ report: r }: { report: ConfidenceReport }) {
  const W = 460;
  const H = 240;
  const padL = 36;
  const padB = 40;
  const padT = 12;
  const groups = r.ranges;
  const gw = (W - padL - 10) / groups.length;
  const max = Math.max(1, ...groups.map((g) => Math.max(g.accepted, g.corrected)));
  return (
    <div className="card p-4">
      <div className="font-semibold text-sm mb-2">Принято и исправлено по диапазонам</div>
      <div className="flex gap-4 text-xs mb-1">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#059669" }} />Принято</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#d97706" }} />Исправлено</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Сравнение принятых и исправленных оценок по диапазонам">
        {groups.map((g, i) => {
          const x0 = padL + i * gw;
          const bw = gw * 0.32;
          const ha = (H - padT - padB) * (g.accepted / max);
          const hc = (H - padT - padB) * (g.corrected / max);
          const base = padT + (H - padT - padB);
          return (
            <g key={g.id}>
              <rect x={x0 + gw * 0.12} y={base - ha} width={bw} height={ha} rx={2} fill="#059669" />
              <rect x={x0 + gw * 0.12 + bw + 3} y={base - hc} width={bw} height={hc} rx={2} fill="#d97706" />
              {g.accepted > 0 && (
                <text x={x0 + gw * 0.12 + bw / 2} y={base - ha - 3} fontSize={8} fill="#065f46" textAnchor="middle">{g.accepted}</text>
              )}
              {g.corrected > 0 && (
                <text x={x0 + gw * 0.12 + bw + 3 + bw / 2} y={base - hc - 3} fontSize={8} fill="#92400e" textAnchor="middle">{g.corrected}</text>
              )}
              <text x={x0 + gw / 2} y={H - padB + 12} fontSize={8} fill="#6b7280" textAnchor="middle">{g.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Correlation({ report: r }: { report: ConfidenceReport }) {
  const c = r.correlation;
  return (
    <div className="card p-4 space-y-2">
      <div className="font-semibold text-sm">Корреляция уверенности и исправлений</div>
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">Коэффициент корреляции</div>
          <div className="text-3xl font-bold tabular-nums">
            {c.r == null ? "—" : c.r.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Проверенных оценок в расчёте</div>
          <div className="text-3xl font-bold tabular-nums">{c.n}</div>
        </div>
      </div>
      {c.warning && (
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          ⚠ {c.warning}
        </div>
      )}
      <p className="text-sm text-gray-600">{c.interpretation}</p>
      <p className="text-xs text-gray-400">
        Метод: корреляция Пирсона между уверенностью и бинарным признаком
        исправления (0/1) — точечно-бисериальная. Корреляция ≠ причинность.
      </p>
    </div>
  );
}

function CorrelationScoreDiff({ report: r }: { report: ConfidenceReport }) {
  const c = r.correlationScoreDiff;
  return (
    <div className="card p-4 space-y-2">
      <div className="font-semibold text-sm">Корреляция уверенности и величины правки</div>
      <div className="flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">Коэффициент (уверенность ↔ |Δ баллов|)</div>
          <div className="text-3xl font-bold tabular-nums">
            {c.r == null ? "—" : c.r.toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Пар в расчёте</div>
          <div className="text-3xl font-bold tabular-nums">{c.n}</div>
        </div>
      </div>
      {c.warning && (
        <div className="rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          ⚠ {c.warning}
        </div>
      )}
      <p className="text-sm text-gray-600">{c.interpretation}</p>
    </div>
  );
}

function AccountantTable({ report: r }: { report: ConfidenceReport }) {
  if (r.byAccountant.length === 0) return null;
  return (
    <div className="card overflow-x-auto">
      <div className="p-3 font-semibold text-sm">По бухгалтерам</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="px-3 py-2">Бухгалтер</th>
            <th className="px-3 py-2 text-right">Проверено</th>
            <th className="px-3 py-2 text-right">Без изменений</th>
            <th className="px-3 py-2 text-right">Исправлено</th>
            <th className="px-3 py-2 text-right">% исправлений</th>
            <th className="px-3 py-2 text-right">Ср. уверенность</th>
            <th className="px-3 py-2 text-right">Ср. |Δ баллов|</th>
            <th className="px-3 py-2 text-right" title="Оценки с уверенностью 90%+, исправленные Маргаритой">90%+ испр.</th>
          </tr>
        </thead>
        <tbody>
          {r.byAccountant.map((a) => (
            <tr key={a.accountant} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{a.accountant}</td>
              <td className="px-3 py-2 text-right tabular-nums">{a.reviewed}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{a.accepted}</td>
              <td className="px-3 py-2 text-right tabular-nums text-amber-700">{a.corrected}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">
                {a.correctionPct == null ? "—" : `${a.correctionPct}%`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(a.avgConfidence, "%")}</td>
              <td className="px-3 py-2 text-right tabular-nums">{a.avgAbsScoreDiff ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-red-700">{a.high90Corrected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MATCH_LABEL: Record<string, { text: string; cls: string }> = {
  exact: { text: "Точное", cls: "bg-emerald-100 text-emerald-700" },
  partial: { text: "Частичное", cls: "bg-blue-100 text-blue-700" },
  mismatch: { text: "Несовпадение", cls: "bg-red-100 text-red-700" },
};

function DetailedTable({ report: r }: { report: ConfidenceReport }) {
  if (r.detailed.length === 0) return null;
  const rows = r.detailed.slice(0, 200);
  return (
    <div className="card overflow-x-auto">
      <div className="p-3 font-semibold text-sm">
        Исправленные оценки{" "}
        <span className="font-normal text-gray-400">
          (показано {rows.length} из {r.detailed.length})
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b">
            <th className="px-2 py-2">Дата</th>
            <th className="px-2 py-2">Бухгалтер</th>
            <th className="px-2 py-2">Чат</th>
            <th className="px-2 py-2 text-right">AI</th>
            <th className="px-2 py-2 text-right">Маргарита</th>
            <th className="px-2 py-2 text-right">Δ</th>
            <th className="px-2 py-2">Категория AI</th>
            <th className="px-2 py-2">Категория М.</th>
            <th className="px-2 py-2 text-right">Увер.</th>
            <th className="px-2 py-2">Совпадение</th>
            <th className="px-2 py-2">Что изменено</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const m = d.matchStatus ? MATCH_LABEL[d.matchStatus] : null;
            return (
              <tr key={d.id} className="border-b last:border-0">
                <td className="px-2 py-1.5 whitespace-nowrap">{d.date}</td>
                <td className="px-2 py-1.5">{d.accountant ?? "—"}</td>
                <td className="px-2 py-1.5">{d.chat}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{d.aiScore ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{d.finalScore}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                  {d.scoreDiff == null ? "—" : `${d.scoreDiff > 0 ? "+" : ""}${d.scoreDiff}`}
                </td>
                <td className="px-2 py-1.5">{d.aiBand ?? "—"}</td>
                <td className="px-2 py-1.5">{d.finalBand}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{d.confidence == null ? "н/д" : `${d.confidence}%`}</td>
                <td className="px-2 py-1.5">
                  {m && <span className={`inline-block rounded px-1.5 py-0.5 ${m.cls}`}>{m.text}</span>}
                </td>
                <td className="px-2 py-1.5 text-gray-600">{d.changedFields.join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
