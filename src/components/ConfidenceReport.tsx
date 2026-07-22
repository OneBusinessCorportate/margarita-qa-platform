"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfidenceReport, ConfidenceRowLite } from "@/lib/confidence-report";
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
  { id: "not_reviewed", label: "Не проверено" },
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

/** Открытый drill-down: заголовок + отобранные строки, стоящие за показателем. */
export interface Drill {
  title: string;
  rows: ConfidenceRowLite[];
}

function Report({ report }: { report: ConfidenceReport }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  // Открыть список чатов за показателем. Клик по карточке отбирает строки
  // report.rows по предикату и показывает их в модальном окне.
  const openDrill = (title: string, predicate: (r: ConfidenceRowLite) => boolean) =>
    setDrill({ title, rows: report.rows.filter(predicate) });
  return (
    <div className="space-y-6">
      <KeyIndicators report={report} onDrill={openDrill} />
      <SummaryCards report={report} onDrill={openDrill} />
      <MatchCards report={report} onDrill={openDrill} />
      <HighlightMetric report={report} onDrill={openDrill} />
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
      {drill && (
        <DrillModal title={drill.title} rows={drill.rows} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

type DrillFn = (title: string, predicate: (r: ConfidenceRowLite) => boolean) => void;

// --- Ключевые показатели калибровки (пп. 3–5) ------------------------------
// Три «выделенных» индикатора цели «откалибровать QA-аналитику»:
//  1) сколько ИСПРАВЛЕНО из оценок с уверенностью ≥90% (внизу — всего ≥90%);
//  2) сколько НЕ исправлено из оценок с уверенностью <90% (внизу — всего <90%);
//  3) доля чатов, где расхождение оценки Маргариты и AI-агента <5%.
function KeyIndicators({ report: r, onDrill }: { report: ConfidenceReport; onDrill: DrillFn }) {
  const { high, low, within5 } = r;
  return (
    <div>
      <div className="text-sm font-semibold mb-2">
        Ключевые показатели калибровки{" "}
        <span className="font-normal text-gray-400">
          (нажмите карточку — покажем чаты)
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <BigIndicator
          title="Исправлено из уверенности ≥90%"
          value={String(high.corrected)}
          bottom={`из ${high.count} с уверенностью ≥90%`}
          extra={high.correctedOfAllPct == null ? undefined : `${high.correctedOfAllPct}% высокоуверенных исправлено`}
          tone="danger"
          onClick={() => onDrill("Исправлено · уверенность ≥90%", (x) => x.high && x.status === "corrected")}
        />
        <BigIndicator
          title="НЕ исправлено из уверенности <90%"
          value={String(low.accepted)}
          bottom={`из ${low.count} с уверенностью <90%`}
          extra={low.acceptedOfAllPct == null ? undefined : `${low.acceptedOfAllPct}% низкоуверенных принято без правок`}
          tone="warn"
          onClick={() => onDrill("Принято без изменений · уверенность <90%", (x) => x.low && x.status === "accepted")}
        />
        <BigIndicator
          title="Расхождение с AI-агентом < 5%"
          value={String(within5.count)}
          bottom={within5.pct == null ? `из ${within5.comparable} сравнимых` : `${within5.pct}% из ${within5.comparable} сравнимых`}
          extra="|оценка Маргариты − AI| < 5 баллов"
          tone="ok"
          onClick={() => onDrill("Расхождение с AI < 5%", (x) => x.within5)}
        />
      </div>
    </div>
  );
}

const BIG_TONE: Record<string, { from: string; text: string }> = {
  danger: { from: "from-red-50 to-amber-50 border-red-200", text: "text-red-700" },
  warn: { from: "from-amber-50 to-yellow-50 border-amber-200", text: "text-amber-700" },
  ok: { from: "from-emerald-50 to-blue-50 border-emerald-200", text: "text-emerald-700" },
};

function BigIndicator({
  title,
  value,
  bottom,
  extra,
  tone,
  onClick,
}: {
  title: string;
  value: string;
  bottom: string;
  extra?: string;
  tone: "danger" | "warn" | "ok";
  onClick?: () => void;
}) {
  const t = BIG_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-5 text-left bg-gradient-to-br ${t.from} transition hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300`}
    >
      <div className="text-sm font-medium text-gray-600">{title}</div>
      <div className={`text-4xl font-bold tabular-nums mt-1 ${t.text}`}>{value}</div>
      <div className="text-sm text-gray-600 mt-1">{bottom}</div>
      {extra && <div className="text-xs text-gray-400 mt-1">{extra}</div>}
      <div className="text-[11px] text-blue-600 mt-2">Показать чаты →</div>
    </button>
  );
}

function MatchCards({ report: r, onDrill }: { report: ConfidenceReport; onDrill: DrillFn }) {
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
        <Card title="Точное совпадение (exact)" value={String(m.exact)} sub={fmtNum(m.exactPct, "%")} color="#059669" onClick={() => onDrill("Точное совпадение", (x) => x.matchStatus === "exact")} />
        <Card title="Частичное (partial)" value={String(m.partial)} sub="±5 баллов / правка критерия" color="#2563eb" onClick={() => onDrill("Частичное совпадение", (x) => x.matchStatus === "partial")} />
        <Card title="Несовпадение (mismatch)" value={String(m.mismatch)} sub={fmtNum(m.mismatchPct, "%")} color="#dc2626" onClick={() => onDrill("Несовпадение", (x) => x.matchStatus === "mismatch")} />
        <Card title="Приемлемо (exact+partial)" value={fmtNum(m.acceptablePct, "%")} sub="доля от сравнимых" color="#059669" onClick={() => onDrill("Приемлемо (exact+partial)", (x) => x.matchStatus === "exact" || x.matchStatus === "partial")} />
        <Card title="Средняя разница баллов" value={m.avgScoreDiff == null ? "Нет данных" : String(m.avgScoreDiff)} sub={`|разница| ${fmtNum(m.avgAbsScoreDiff)}`} />
        <Card title="Медиана разницы баллов" value={m.medianScoreDiff == null ? "Нет данных" : String(m.medianScoreDiff)} />
        <Card title="Ср. уверенность — совпало" value={fmtNum(m.avgConfidenceMatched, "%")} color="#059669" onClick={() => onDrill("Совпало (exact+partial)", (x) => x.matchStatus === "exact" || x.matchStatus === "partial")} />
        <Card title="Ср. уверенность — несовпало" value={fmtNum(m.avgConfidenceMismatched, "%")} color="#dc2626" onClick={() => onDrill("Несовпадение", (x) => x.matchStatus === "mismatch")} />
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  sub,
  color = "#1f2937",
  onClick,
}: {
  title: string;
  value: string;
  sub?: string;
  color?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      {onClick && <div className="text-[11px] text-blue-600 mt-1">Показать чаты →</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card p-4 text-left transition hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {body}
      </button>
    );
  }
  return <div className="card p-4">{body}</div>;
}

function SummaryCards({ report: r, onDrill }: { report: ConfidenceReport; onDrill: DrillFn }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="Всего AI-оценок" value={String(r.total)} sub={`${r.withConfidence} с уверенностью · ${r.noConfidence} без данных`} onClick={() => onDrill("Все AI-оценки", () => true)} />
      <Card
        title="Принято без изменений"
        value={String(r.accepted)}
        sub={`${r.acceptedPct}% от всех`}
        color="#059669"
        onClick={() => onDrill("Принято без изменений", (x) => x.status === "accepted")}
      />
      <Card
        title="Исправлено Маргаритой"
        value={String(r.corrected)}
        sub={`${r.correctedPct}% от всех`}
        color="#d97706"
        onClick={() => onDrill("Исправлено Маргаритой", (x) => x.status === "corrected")}
      />
      <Card
        title="Не проверено"
        value={String(r.notReviewed)}
        sub={`${r.notReviewedPct}% от всех`}
        color="#6b7280"
        onClick={() => onDrill("Не проверено", (x) => x.status === "not_reviewed")}
      />
      <Card
        title="Процент исправлений"
        value={fmtNum(r.overallCorrectionPct, "%")}
        sub="исправлено / проверено"
        color="#d97706"
        onClick={() => onDrill("Исправлено Маргаритой", (x) => x.status === "corrected")}
      />
      <Card
        title="Средняя уверенность — принятые"
        value={fmtNum(r.avgConfidenceAccepted, "%")}
        color="#059669"
        onClick={() => onDrill("Принято без изменений", (x) => x.status === "accepted")}
      />
      <Card
        title="Средняя уверенность — исправленные"
        value={fmtNum(r.avgConfidenceCorrected, "%")}
        color="#d97706"
        onClick={() => onDrill("Исправлено Маргаритой", (x) => x.status === "corrected")}
      />
      <Card
        title="Оценок с уверенностью ≥90%"
        value={String(r.high.count)}
        sub={r.high.pct == null ? "Нет данных" : `${r.high.pct}% · исправлено ${r.high.corrected}`}
        color="#2563eb"
        onClick={() => onDrill("Уверенность ≥90%", (x) => x.high)}
      />
    </div>
  );
}

function HighlightMetric({ report: r, onDrill }: { report: ConfidenceReport; onDrill: DrillFn }) {
  const val = r.high.accuracyPct;
  return (
    <button
      type="button"
      onClick={() => onDrill("Проверено · уверенность ≥90%", (x) => x.high && x.reviewed)}
      className="card p-6 w-full text-left bg-gradient-to-br from-emerald-50 to-blue-50 border-emerald-200 transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      <div className="text-sm font-medium text-gray-600">
        Точность оценок с уверенностью 90%+
      </div>
      <div className="text-5xl font-bold tabular-nums text-emerald-700 mt-2">
        {fmtNum(val, "%")}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        Принято без изменений ({r.high.accepted}) / проверено ({r.high.reviewed}) × 100.
        {r.high.reviewed === 0 && " Нет проверенных оценок ≥90% в выборке."}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Гипотеза: оценки с уверенностью ≥90% должны редко требовать исправлений.
      </div>
      <div className="text-[11px] text-blue-600 mt-2">Показать чаты →</div>
    </button>
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
            <th className="px-3 py-2 text-right">Не пров.</th>
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

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  accepted: { text: "Принято без изменений", cls: "bg-emerald-100 text-emerald-700" },
  corrected: { text: "Исправлено", cls: "bg-amber-100 text-amber-800" },
  not_reviewed: { text: "Не проверено", cls: "bg-gray-100 text-gray-500" },
};

// --- Drill-down: чаты за показателем ---------------------------------------
// Модальное окно со списком чатов (их оценки AI/Маргариты, уверенность, статус,
// совпадение) — открывается по клику на любую карточку показателя.
function DrillModal({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: ConfidenceRowLite[];
  onClose: () => void;
}) {
  // Закрытие по Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = rows.slice(0, 500);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-5xl my-8 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold text-sm">
            {title}{" "}
            <span className="font-normal text-gray-400">
              — {rows.length} {rows.length === 1 ? "чат" : "чатов"}
              {rows.length > shown.length && ` (показано ${shown.length})`}
            </span>
          </div>
          <button className="btn-secondary !px-3 !py-1 text-xs" onClick={onClose}>
            Закрыть ✕
          </button>
        </div>
        {shown.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Нет чатов в этой выборке.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="px-2 py-2">Дата</th>
                  <th className="px-2 py-2">Бухгалтер</th>
                  <th className="px-2 py-2">Чат</th>
                  <th className="px-2 py-2 text-right">AI</th>
                  <th className="px-2 py-2 text-right">Маргарита</th>
                  <th className="px-2 py-2 text-right">Δ</th>
                  <th className="px-2 py-2 text-right">Увер.</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2">Совпадение</th>
                  <th className="px-2 py-2">Что изменено</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const m = d.matchStatus ? MATCH_LABEL[d.matchStatus] : null;
                  const s = STATUS_LABEL[d.status];
                  return (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="px-2 py-1.5 whitespace-nowrap">{d.date}</td>
                      <td className="px-2 py-1.5">{d.accountant ?? "—"}</td>
                      <td className="px-2 py-1.5 font-medium">{d.chat}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.aiScore ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{d.finalScore}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                        {d.scoreDiff == null ? "—" : `${d.scoreDiff > 0 ? "+" : ""}${d.scoreDiff}`}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {d.confidence == null ? "н/д" : `${d.confidence}%`}
                      </td>
                      <td className="px-2 py-1.5">
                        {s && <span className={`inline-block rounded px-1.5 py-0.5 ${s.cls}`}>{s.text}</span>}
                      </td>
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
        )}
      </div>
    </div>
  );
}
