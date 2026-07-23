// ---------------------------------------------------------------------------
// Чистая логика фичи «Уверенность модели» — без доступа к БД, чтобы её могли
// переиспользовать и репозиторий (при сохранении оценки), и аналитический отчёт,
// и тесты. Здесь живут:
//   • диапазоны уверенности (0–49 / 50–69 / 70–79 / 80–89 / 90–94 / 95–100);
//   • вывод статуса проверки (принято / исправлено) из снимка AI и финала;
//   • корреляция Пирсона + её интерпретация по-русски + порог достаточности;
//   • границы отчётных периодов в часовом поясе Ереван (Asia/Yerevan).
// ---------------------------------------------------------------------------

import type { CriteriaScores } from "./scoring";
import type { AiSnapshot } from "./ai";
import type { Evaluation, EvaluationScores, ReviewStatus } from "./types";

// --- Диапазоны уверенности --------------------------------------------------

export interface ConfidenceRange {
  id: string;
  label: string;
  min: number; // включительно
  max: number; // включительно
}

/** Требуемые ТЗ диапазоны. Границы не пересекаются и покрывают 0..100. */
export const CONFIDENCE_RANGES: ConfidenceRange[] = [
  { id: "0-49", label: "0–49%", min: 0, max: 49 },
  { id: "50-69", label: "50–69%", min: 50, max: 69 },
  { id: "70-79", label: "70–79%", min: 70, max: 79 },
  { id: "80-89", label: "80–89%", min: 80, max: 89 },
  { id: "90-94", label: "90–94%", min: 90, max: 94 },
  { id: "95-100", label: "95–100%", min: 95, max: 100 },
];

/** Порог «высокой уверенности» из бизнес-гипотезы (≥90% ⇒ редкие правки). */
export const HIGH_CONFIDENCE_THRESHOLD = 90;

/**
 * Бизнес-правило: модель НИКОГДА не показывает уверенность выше 95% — всегда
 * остаётся «зазор» на неопределённость. Новые прогнозы уже ограничены этим
 * потолком при генерации (CONF_CEIL в ai.ts), а этот потолок применяется ещё и
 * при ЧТЕНИИ/ПОКАЗЕ, чтобы редкие легаси-строки (сохранённые, когда потолок был
 * 97%) тоже не показывали >95%. Сырые данные в БД при этом не переписываются.
 */
export const MAX_CONFIDENCE = 95;

// --- Ярлык и тон уверенности для UI ----------------------------------------
// Пояснительные ярлыки (главным значением остаётся ПРОЦЕНТ). Отдельно от
// статистических бакетов (CONFIDENCE_RANGES) — у тех своя, более дробная сетка.

export type ConfidenceTone = "low" | "medium" | "high" | "veryHigh" | "none";

export interface ConfidenceDisplay {
  /** Точный процент как строка, либо «Недостаточно данных». */
  text: string;
  /** Пояснительный ярлык («Средняя уверенность») либо «Нет данных». */
  label: string;
  tone: ConfidenceTone;
  /** true, когда уверенность низкая / отсутствует — нужна ручная проверка. */
  warn: boolean;
}

/**
 * Ярлык и тон для показа уверенности. Пороги из ТЗ:
 *   0–49 — Низкая; 50–74 — Средняя; 75–89 — Высокая; 90–100 — Очень высокая.
 * `null`/невалидное значение ⇒ «Недостаточно данных» (НЕ 0% и НЕ 90%).
 * Низкая уверенность и «нет данных» помечаются warn=true (предупреждающий стиль).
 */
export function confidenceDisplay(
  confidence: number | null | undefined,
  opts?: { preliminary?: boolean; incompleteData?: boolean }
): ConfidenceDisplay {
  const raw = validConfidence(confidence);
  const c = raw == null ? null : Math.min(MAX_CONFIDENCE, raw);
  if (c == null) {
    return { text: "Недостаточно данных", label: "Нет данных", tone: "none", warn: true };
  }
  let tone: ConfidenceTone;
  let label: string;
  if (c < 50) {
    tone = "low";
    label = "Низкая уверенность";
  } else if (c < 75) {
    tone = "medium";
    label = "Средняя уверенность";
  } else if (c < 90) {
    tone = "high";
    label = "Высокая уверенность";
  } else {
    tone = "veryHigh";
    label = "Очень высокая уверенность";
  }
  const warn = tone === "low" || Boolean(opts?.incompleteData) || Boolean(opts?.preliminary && c >= 75);
  return { text: `${Math.round(c)}%`, label, tone, warn };
}

/** Диапазон, которому принадлежит значение уверенности, либо null (нет данных). */
export function rangeOf(confidence: number | null | undefined): ConfidenceRange | null {
  if (confidence == null || Number.isNaN(confidence)) return null;
  const c = clampConfidence(confidence);
  return CONFIDENCE_RANGES.find((r) => c >= r.min && c <= r.max) ?? null;
}

export function clampConfidence(c: number): number {
  return Math.max(0, Math.min(100, c));
}

/** Валидная уверенность = число 0..100. Иначе — «нет данных» (null). */
export function validConfidence(c: unknown): number | null {
  if (typeof c !== "number" || Number.isNaN(c)) return null;
  if (c < 0 || c > 100) return null;
  return c;
}

// --- Статус проверки (принято / исправлено) --------------------------------

/**
 * Достала уверенность AI из строки оценки: сперва из колонки `ai_confidence`,
 * затем из снимка `scores.ai.confidence`. Возвращает null, если данных нет
 * (легаси-строки, менеджер/юрист без прогноза) — такие НЕ считаются 0%.
 */
export function evaluationConfidence(e: Pick<Evaluation, "ai_confidence" | "scores">): number | null {
  const direct = validConfidence(e.ai_confidence);
  const v = direct != null ? direct : validConfidence(e.scores?.ai?.confidence);
  // Бизнес-правило «не выше 95%» применяется и при чтении (легаси-строки с 96–97%).
  return v == null ? null : Math.min(MAX_CONFIDENCE, v);
}

/** Исходная общая оценка AI (колонка `ai_total` или снимок `scores.ai.total`). */
export function evaluationAiTotal(e: Pick<Evaluation, "ai_total" | "scores">): number | null {
  if (typeof e.ai_total === "number" && !Number.isNaN(e.ai_total)) return e.ai_total;
  const t = e.scores?.ai?.total;
  return typeof t === "number" && !Number.isNaN(t) ? t : null;
}

function sameCriteria(a: CriteriaScores | undefined, b: CriteriaScores | undefined): boolean {
  const av = a ?? {};
  const bv = b ?? {};
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  for (const k of keys) {
    const x = (av as Record<string, number | undefined>)[k];
    const y = (bv as Record<string, number | undefined>)[k];
    if ((x ?? null) !== (y ?? null)) return false;
  }
  return true;
}

function sameMonthly(
  ai: Record<string, { status: string }> | undefined,
  final: EvaluationScores["monthly"] | undefined
): boolean {
  const a = ai ?? {};
  const f = final ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(f)]);
  for (const k of keys) {
    const x = a[k]?.status ?? "";
    const y = (f[k]?.status ?? "") as string;
    if (x !== y) return false;
  }
  return true;
}

/**
 * Определяет статус проверки, сравнивая финальную оценку Маргариты с ИСХОДНЫМ
 * снимком AI. Возвращает:
 *   • null            — сравнивать не с чем (нет снимка AI) ⇒ оставить not_reviewed;
 *   • "accepted"      — критерии, статусы рассылок и общая оценка совпали;
 *   • "corrected"     — что-то отличается ⇒ Маргарита исправила.
 */
export function reviewStatusFor(
  aiSnapshot: AiSnapshot | EvaluationScores["ai"] | null | undefined,
  finalScores: EvaluationScores,
  finalTotal: number
): "accepted" | "corrected" | null {
  if (!aiSnapshot || typeof aiSnapshot.total !== "number") return null;
  const totalEqual = Math.round(aiSnapshot.total) === Math.round(finalTotal);
  const critEqual = sameCriteria(aiSnapshot.criteria, finalScores.criteria);
  const monthlyEqual = sameMonthly(aiSnapshot.monthly, finalScores.monthly);
  return totalEqual && critEqual && monthlyEqual ? "accepted" : "corrected";
}

/** Проверена ли строка (принята или исправлена). */
export function isReviewed(status: ReviewStatus | undefined | null): boolean {
  return status === "accepted" || status === "corrected";
}

// --- Корреляция Пирсона -----------------------------------------------------

/** Минимум проверенных оценок для «надёжного» вывода о корреляции. */
export const MIN_REVIEWED_FOR_CORRELATION = 30;

export const INSUFFICIENT_DATA_MESSAGE =
  "Недостаточно данных для надёжного вывода. Необходимо минимум 30 проверенных оценок.";

/**
 * Коэффициент корреляции Пирсона по парам (x, y). Возвращает null, если пар
 * меньше двух или дисперсия любой переменной нулевая (например, все оценки
 * приняты — тогда «связь» математически не определена).
 */
export function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pairs) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx;
    const dy = y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export interface CorrelationInterpretation {
  /** Русский текст-вывод для UI. */
  text: string;
  /** true, если проверенных оценок меньше порога — вывод ненадёжен. */
  insufficient: boolean;
}

/**
 * Интерпретация корреляции «уверенность ↔ исправление» по-русски. Знак:
 *   • отрицательная — выше уверенность ⇒ меньше правок (ожидаемо, логика верна);
 *   • около нуля    — явной связи не выявлено;
 *   • положительная — более уверенные оценки правят чаще ⇒ логика уверенности,
 *     возможно, некорректна.
 */
export function interpretCorrelation(
  r: number | null,
  n: number
): CorrelationInterpretation {
  const insufficient = n < MIN_REVIEWED_FOR_CORRELATION;
  if (r == null) {
    return {
      text:
        "Связь не определена: недостаточно разброса в данных (например, все проверенные оценки имеют одинаковый статус).",
      insufficient,
    };
  }
  let text: string;
  if (r <= -0.1) {
    text =
      "Отрицательная корреляция: чем выше уверенность модели, тем реже Маргарита исправляет оценку. Логика уверенности работает как ожидается.";
  } else if (r >= 0.1) {
    text =
      "Положительная корреляция: более уверенные оценки исправляются чаще — логика расчёта уверенности, возможно, некорректна.";
  } else {
    text =
      "Корреляция близка к нулю: явной связи между уверенностью модели и исправлениями не выявлено.";
  }
  return { text, insufficient };
}

// --- Отчётные периоды в часовом поясе Ереван (Asia/Yerevan) -----------------

const YEREVAN_TZ = "Asia/Yerevan";

/** Календарная дата «сейчас» в Ереване как YYYY-MM-DD. */
export function yerevanDate(nowISO?: string): string {
  const d = nowISO ? new Date(nowISO) : new Date();
  // en-CA форматирует как YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: YEREVAN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Сдвиг ISO-даты (YYYY-MM-DD) на delta дней (в календаре, без учёта TZ). */
export function shiftDate(dateISO: string, delta: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Понедельник недели, содержащей дату (ISO YYYY-MM-DD). Недели с понедельника. */
export function mondayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=вс .. 6=сб
  const back = dow === 0 ? 6 : dow - 1;
  return shiftDate(dateISO, -back);
}

/** Первое число месяца даты (ISO YYYY-MM-DD). */
export function firstOfMonth(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "custom";

/**
 * Границы {from,to} (ISO YYYY-MM-DD, включительно) для пресета периода,
 * рассчитанные по календарю Еревана. Для «custom» возвращает переданные from/to.
 */
export function periodRange(
  preset: PeriodPreset,
  nowISO?: string,
  custom?: { from?: string; to?: string }
): { from?: string; to?: string } {
  const today = yerevanDate(nowISO);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDate(today, -1);
      return { from: y, to: y };
    }
    case "week":
      return { from: mondayOf(today), to: today };
    case "month":
      return { from: firstOfMonth(today), to: today };
    case "custom":
    default:
      return { from: custom?.from, to: custom?.to };
  }
}
