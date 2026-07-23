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

/** Процент как основное значение: «70%» либо «Нет данных». */
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "Нет данных";
  return `${n}%`;
}

/** Абсолютное «84 из 120 проверок» под процентом. */
function ofChecks(part: number, whole: number): string {
  return `${part} из ${whole} ${pluralChecks(whole)}`;
}

function pluralChecks(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "проверок";
  if (mod10 === 1) return "проверка";
  if (mod10 >= 2 && mod10 <= 4) return "проверки";
  return "проверок";
}

// ---------------------------------------------------------------------------
// Пояснительные тексты для тултипов (бизнес-язык, без техножаргона). Каждый
// объясняет: что означает показатель, какие поля сравниваются, формулу,
// знаменатель, исключаются ли неполные записи и пересечение с другими
// категориями (требование менеджера — «тултипы или инструкция … и в остальных»).
// ---------------------------------------------------------------------------
const TIP = {
  exact:
    "Точное совпадение: AI и итоговая оценка Маргариты полностью совпали — по общей оценке (категории), решению о нарушении рассылки и ВСЕМ применимым критериям и статусам рассылок. Совпадения только по общему баллу недостаточно: если отличается хотя бы один критерий — это уже не точное совпадение. Формула: точные совпадения ÷ все валидные проверки (где сохранены и исходная оценка AI, и финал Маргариты) × 100. Неполные записи («Недостаточно данных») в знаменатель не входят.",
  mismatch:
    "Несовпадение: отличается хотя бы одно оцениваемое поле (общая оценка, критерий, статус рассылки или решение о нарушении), поэтому запись не является точным совпадением. Формула: несовпадения ÷ все валидные проверки × 100 = 100% − «Точное совпадение %» (тот же знаменатель). «Частичное совпадение» — это ПОДМНОЖЕСТВО несовпадений (совпала часть критериев).",
  partial:
    "Частичное совпадение: подмножество несовпадений, где совпала ЧАСТЬ критериев, категория и решение о рассылке не изменились, а общий балл отличается не более чем на 5 из 100. Детальный процент ниже — доля совпавших критериев внутри таких проверок (совпавшие критерии ÷ все сравнимые критерии × 100).",
  insufficient:
    "Недостаточно данных: проверки без исходного снимка AI (не с чем сравнивать), без финала Маргариты или без сравнимых критериев. Такие записи показываются отдельно и ИСКЛЮЧЕНЫ из знаменателя процентов совпадения — они не считаются ни совпадением, ни несовпадением.",
  accepted:
    "Принято без изменений: Маргарита сохранила исходную оценку AI, не изменив ни одно оцениваемое поле. Это ровно то же множество записей, что «Точное совпадение». Может быть верным даже при низкой уверенности AI — это не повышает исходную уверенность задним числом. Формула: принято ÷ проверено × 100. Не выводится из уверенности, отсутствия комментариев или совпадения только общего балла.",
  corrected:
    "Исправлено Маргаритой: Маргарита изменила хотя бы одно оцениваемое поле по сравнению с исходной оценкой AI. Совпадает с множеством «Несовпадение». Формула: исправлено ÷ проверено × 100. Разбивка «что изменено» — в таблице ниже.",
  notReviewed:
    "Не активно / не проверено: AI сформировал оценку, но Маргарита ещё не проверяла её. Такие записи не входят в знаменатель процентов «принято/исправлено» и совпадений.",
  total:
    "Все AI-оценки за выбранный период и фильтры. Из них «с уверенностью» — где сохранено валидное значение уверенности AI; «без данных» — легаси-строки без уверенности (в расчёты по уверенности не входят).",
  overallCorrection:
    "Процент исправлений = исправлено ÷ проверено × 100. Знаменатель — только проверенные записи (не все AI-оценки).",
  high90:
    "Оценки, где уверенность AI была ≥90%. Если модель уверена, Маргарита почти не должна их править — доля исправлений здесь показывает, не завышена ли уверенность.",
  closeAgreement:
    "Согласие по баллам: доля проверенных записей с AI-снимком, где итоговая оценка Маргариты и AI расходится менее чем на 5 из 100. Знаменатель — сравнимые проверки (проверено + есть AI-снимок).",
  avgConfMatched:
    "Средняя уверенность AI по записям, где оценки совпали (точное или частичное). Сравните со средней уверенностью по несовпадениям — так видно, откалибрована ли уверенность.",
} as const;

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

type DrillFn = (title: string, predicate: (r: ConfidenceRowLite) => boolean) => void;

function Report({ report }: { report: ConfidenceReport }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  // Открыть список чатов за показателем: отбираем строки report.rows по
  // предикату и показываем их в модальном окне.
  const openDrill: DrillFn = (title, predicate) =>
    setDrill({ title, rows: report.rows.filter(predicate) });
  return (
    <div className="space-y-6">
      <Instructions />
      <CalibrationHighlights report={report} onDrill={openDrill} />
      <SummaryCards report={report} onDrill={openDrill} />
      <MatchCards report={report} onDrill={openDrill} />
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

/**
 * Видимый блок-инструкция рядом с аналитикой (требование менеджера): что означает
 * каждая категория, какие поля сравниваются, формула и знаменатель, пересечения.
 * Свёрнут по умолчанию, чтобы не мешать; каждая карточка также имеет тултип «?».
 */
function Instructions() {
  const [open, setOpen] = useState(false);
  const rows: { title: string; body: string; color: string }[] = [
    { title: "Точное совпадение", body: TIP.exact, color: "#059669" },
    { title: "Несовпадение", body: TIP.mismatch, color: "#dc2626" },
    { title: "Частичное совпадение", body: TIP.partial, color: "#2563eb" },
    { title: "Принято без изменений", body: TIP.accepted, color: "#059669" },
    { title: "Исправлено Маргаритой", body: TIP.corrected, color: "#d97706" },
    { title: "Недостаточно данных", body: TIP.insufficient, color: "#6b7280" },
  ];
  return (
    <div className="card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm font-semibold text-gray-800">
          📖 Как читать показатели: что такое точное совпадение, несовпадение и остальное
        </span>
        <span className="text-xs text-blue-600">{open ? "Свернуть ▲" : "Показать ▼"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-600">
            Основное значение на карточках — <b>процент</b>, абсолютное число («84
            из 120 проверок») указано ниже. Все проценты совпадения считаются от
            <b> валидных проверок</b>: тех, где сохранены и исходная оценка AI, и
            итоговая оценка Маргариты. «Точное совпадение %» и «Несовпадение %» в
            сумме дают 100%.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.title} className="rounded border border-gray-100 bg-gray-50 p-3">
                <dt className="text-xs font-semibold" style={{ color: row.color }}>
                  {row.title}
                </dt>
                <dd className="mt-1 text-[11px] leading-snug text-gray-600">{row.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function MatchCards({ report: r, onDrill }: { report: ConfidenceReport; onDrill: DrillFn }) {
  const m = r.matches;
  const valid = m.validReviewed;
  // Несовпадение (широкое) = не точное совпадение = частичное + значимое.
  const isMismatchBroad = (x: ConfidenceRowLite) =>
    x.matchStatus === "partial" || x.matchStatus === "mismatch";
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold flex items-center">
        Совпадения AI ↔ итоговая оценка Маргариты{" "}
        <span className="font-normal text-gray-400 ml-1">
          (валидных проверок для сравнения: {valid})
        </span>
        <InfoDot text={`Знаменатель всех процентов ниже — валидные проверки: где сохранены и исходная оценка AI, и финал Маргариты. Всего таких ${valid}. «Точное совпадение %» + «Несовпадение %» = 100%.`} />
      </div>
      {/* Основные показатели — % как главное значение, абсолют ниже (требование менеджера). */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          title="Точное совпадение"
          value={valid > 0 ? fmtPct(m.exactPct) : "Нет данных"}
          sub={valid > 0 ? ofChecks(m.exact, valid) : undefined}
          color="#059669"
          tooltip={TIP.exact}
          onClick={() => onDrill("Точное совпадение", (x) => x.matchStatus === "exact")}
        />
        <Card
          title="Несовпадение"
          value={valid > 0 ? fmtPct(m.mismatchBroadPct) : "Нет данных"}
          sub={valid > 0 ? ofChecks(m.mismatchBroad, valid) : undefined}
          sub2="= 100% − точное совпадение"
          color="#dc2626"
          tooltip={TIP.mismatch}
          onClick={() => onDrill("Несовпадение (частичное + значимое)", isMismatchBroad)}
        />
        <Card
          title="Частичное совпадение"
          value={valid > 0 ? fmtPct(m.partialPct) : "Нет данных"}
          sub={valid > 0 ? ofChecks(m.partial, valid) : undefined}
          sub2={
            m.partialFieldsAgreementPct == null
              ? "подмножество несовпадений"
              : `совпало критериев ${m.partialFieldsMatched}/${m.partialFieldsTotal} = ${m.partialFieldsAgreementPct}%`
          }
          color="#2563eb"
          tooltip={TIP.partial}
          onClick={() => onDrill("Частичное совпадение", (x) => x.matchStatus === "partial")}
        />
        <Card
          title="Недостаточно данных"
          value={String(m.excludedNoBaseline)}
          sub2="исключены из знаменателя"
          color="#6b7280"
          tooltip={TIP.insufficient}
        />
      </div>
      {/* Дополнительная аналитика по расхождению баллов. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Значимое несовпадение" value={valid > 0 ? fmtPct(m.mismatchPct) : "Нет данных"} sub={valid > 0 ? ofChecks(m.mismatch, valid) : undefined} sub2="сменилась категория/рассылка или |Δ|>5" color="#dc2626" onClick={() => onDrill("Значимое несовпадение", (x) => x.matchStatus === "mismatch")} />
        <Card title="Средняя разница баллов" value={m.avgScoreDiff == null ? "Нет данных" : String(m.avgScoreDiff)} sub2={`|разница| ${fmtNum(m.avgAbsScoreDiff)}`} />
        <Card title="Ср. уверенность — совпало" value={fmtNum(m.avgConfidenceMatched, "%")} color="#059669" tooltip={TIP.avgConfMatched} onClick={() => onDrill("Совпало (точное+частичное)", (x) => x.matchStatus === "exact" || x.matchStatus === "partial")} />
        <Card title="Ср. уверенность — несовпало" value={fmtNum(m.avgConfidenceMismatched, "%")} color="#dc2626" tooltip={TIP.avgConfMatched} onClick={() => onDrill("Несовпадение (частичное + значимое)", isMismatchBroad)} />
      </div>
    </div>
  );
}

/**
 * Информационная иконка с всплывающей подсказкой (тултип). Чистый CSS/React без
 * библиотек: подсказка появляется при наведении и при фокусе с клавиатуры
 * (доступность). `stopPropagation`, чтобы клик по иконке не открывал drill-down
 * родительской карточки.
 */
function InfoDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Пояснение к показателю"
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-6 z-40 w-72 rounded-md border border-gray-200 bg-white p-3 text-left text-[11px] font-normal leading-snug text-gray-700 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </span>
      )}
    </span>
  );
}

function Card({
  title,
  value,
  sub,
  sub2,
  color = "#1f2937",
  onClick,
  tooltip,
}: {
  title: string;
  value: string;
  sub?: string;
  sub2?: string;
  color?: string;
  onClick?: () => void;
  tooltip?: string;
}) {
  const body = (
    <>
      <div className="mb-1 flex items-start text-xs text-gray-500">
        <span>{title}</span>
        {tooltip && <InfoDot text={tooltip} />}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-1 tabular-nums">{sub}</div>}
      {sub2 && <div className="text-[11px] text-gray-400 mt-0.5">{sub2}</div>}
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
      <Card title="Всего AI-оценок" value={String(r.total)} sub2={`${r.withConfidence} с уверенностью · ${r.noConfidence} без данных`} tooltip={TIP.total} onClick={() => onDrill("Все AI-оценки", () => true)} />
      <Card
        title="Принято без изменений"
        value={r.reviewed > 0 ? fmtPct(r.acceptedOfReviewedPct) : "Нет данных"}
        sub={r.reviewed > 0 ? ofChecks(r.accepted, r.reviewed) : undefined}
        color="#059669"
        tooltip={TIP.accepted}
        onClick={() => onDrill("Принято без изменений", (x) => x.status === "accepted")}
      />
      <Card
        title="Исправлено Маргаритой"
        value={r.reviewed > 0 ? fmtPct(r.overallCorrectionPct) : "Нет данных"}
        sub={r.reviewed > 0 ? ofChecks(r.corrected, r.reviewed) : undefined}
        color="#d97706"
        tooltip={TIP.corrected}
        onClick={() => onDrill("Исправлено Маргаритой", (x) => x.status === "corrected")}
      />
      <Card
        title="Не активно"
        value={String(r.notReviewed)}
        sub2={`${r.notReviewedPct}% от всех AI-оценок`}
        color="#6b7280"
        tooltip={TIP.notReviewed}
        onClick={() => onDrill("Не активно / не проверено", (x) => x.status === "not_reviewed")}
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
        value={r.high.pct == null ? "Нет данных" : fmtPct(r.high.pct)}
        sub={r.high.pct == null ? undefined : ofChecks(r.high.count, r.withConfidence)}
        sub2={`исправлено ${r.high.corrected}`}
        color="#2563eb"
        tooltip={TIP.high90}
        onClick={() => onDrill("Уверенность ≥90%", (x) => x.high)}
      />
    </div>
  );
}

function CalibrationHighlights({ report: r, onDrill }: { report: ConfidenceReport; onDrill: DrillFn }) {
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
          оценкам Маргариты. Нажмите любой показатель — покажем стоящие за ним чаты.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Основной показатель 1 (п.3): исправлено из уверенности ≥90%. */}
        <button
          type="button"
          onClick={() => onDrill("Исправлено · уверенность ≥90%", (x) => x.high && x.status === "corrected")}
          className="card p-6 text-left w-full bg-gradient-to-br from-amber-50 to-white border-amber-200 transition hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
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
            <span
              className="font-semibold tabular-nums text-gray-700 underline decoration-dotted"
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onDrill("Уверенность ≥90%", (x) => x.high);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onDrill("Уверенность ≥90%", (x) => x.high);
                }
              }}
            >
              {r.high.count}
            </span>{" "}
            <span className="text-gray-400">(проверено {r.high.reviewed})</span>
          </div>
          <div className="text-[11px] text-blue-600 mt-2">Показать чаты →</div>
        </button>

        {/* Основной показатель 2 (п.4): НЕ исправлено из уверенности <90%. */}
        <button
          type="button"
          onClick={() => onDrill("Принято без изменений · уверенность <90%", (x) => x.low && x.status === "accepted")}
          className="card p-6 text-left w-full bg-gradient-to-br from-blue-50 to-white border-blue-200 transition hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
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
            <span
              className="font-semibold tabular-nums text-gray-700 underline decoration-dotted"
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onDrill("Уверенность <90%", (x) => x.low);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onDrill("Уверенность <90%", (x) => x.low);
                }
              }}
            >
              {r.low.count}
            </span>{" "}
            <span className="text-gray-400">(проверено {r.low.reviewed})</span>
          </div>
          <div className="text-[11px] text-blue-600 mt-2">Показать чаты →</div>
        </button>
      </div>

      {/* Показатель 5: чаты с отклонением оценки <5% между Маргаритой и AI. */}
      <button
        type="button"
        onClick={() => onDrill("Расхождение с AI < 5%", (x) => x.closeAgreement)}
        className="card p-6 text-left w-full bg-gradient-to-br from-emerald-50 to-white border-emerald-200 transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        <div className="text-sm font-medium text-gray-600 flex items-center">
          Согласие оценок: чаты с отклонением{" "}
          <span className="font-semibold mx-1">&lt;5%</span> между Маргаритой и AI
          <InfoDot text={TIP.closeAgreement} />
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
        <div className="text-[11px] text-blue-600 mt-2">Показать чаты →</div>
      </button>
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

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  accepted: { text: "Принято без изменений", cls: "bg-emerald-100 text-emerald-700" },
  corrected: { text: "Исправлено", cls: "bg-amber-100 text-amber-800" },
  not_reviewed: { text: "Не активно", cls: "bg-gray-100 text-gray-500" },
};

// --- Drill-down: чаты за показателем ---------------------------------------
// Модальное окно со списком чатов (их оценки AI/Маргариты, разница, уверенность,
// статус, совпадение) — открывается по клику на любую карточку показателя.
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
