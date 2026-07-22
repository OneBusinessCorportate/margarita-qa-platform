// ---------------------------------------------------------------------------
// Telegram message templates. v1 is COPY-TO-CLIPBOARD ONLY — no bot send.
// All wording lives here so it is trivial to edit in one place.
//
// Three kinds of message, matching what Margarita copies today:
//   1. buildReportMessage   — daily report (Сервис + Задачи Бухгалтерии).
//   2. buildScoreMessage    — per-chat / per-accountant evaluation.
//   3. surveyInvite*        — the AM/RU client survey invitation (typeform).
//
// TODO(margarita): confirm exact wording/format — pending her answer.
// A future "Send via bot" path can call sendToTelegram(text) guarded by
// telegramConfigured().
// ---------------------------------------------------------------------------

import type { AccountantScore, DailyReport } from "./report";
import { MONTHLY_CATEGORIES, bandFor, failingMailings, type QualityBand } from "./scoring";
import type { Chat, Evaluation, Violation } from "./types";
import { groupNarusheniya } from "./violations";
import type { ViolationReport } from "./violation-report";
import type { ViolationWorkflowReport } from "./appeals-report";
import type { AnalyticsReport } from "./analytics";
import type { MailingComplianceReport } from "./mailing-compliance";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** DD.MM from an ISO date (for the report header). */
function fmtDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : iso;
}

// Colour cue per quality band, so each person's mark reads at a glance.
const BAND_EMOJI: Record<QualityBand, string> = {
  Отлично: "🟢",
  Хорошо: "🟡",
  Плохо: "🟠",
  Критично: "🔴",
};

export interface ReportMessageOptions {
  /** Violations for the reported window — grouped per accountant. */
  violations?: Violation[];
  /** Optional Google-Sheet (or any) link appended at the end. */
  sheetUrl?: string;
  /** ISO date shown in the header; defaults to the filter's `to`, else today. */
  date?: string;
  /**
   * Canonical employee names (the active accountant roster). When provided,
   * the stars / requests sections show ONLY these people — import artifacts
   * ("-", "#N/A") and ex-employees found in old evaluations are silently
   * skipped. The overall service % still reflects every evaluated chat.
   */
  roster?: string[];
  /** Client-request totals per accountant for the «Кол-во запросов» section. */
  requests?: { accountant: string; count: number }[];
  /** Days in the window — divides `requests` totals into a per-day figure. */
  requestDays?: number;
}

/** Period label for the header: a single day, or "DD.MM — DD.MM" for a range. */
function periodHeader(report: DailyReport, dateISO: string): string {
  const { from, to } = report.filters;
  if (from && to && from !== to) return `${fmtDay(from)} — ${fmtDay(to)}`;
  return fmtDay(to ?? from ?? dateISO);
}

/** Pretty contract label "№123 Имя" (name trimmed for Telegram width). */
function chatLabel(agrNo: string, name: string | null): string {
  if (!name) return `№${agrNo}`;
  const short = name.length > 42 ? `${name.slice(0, 39)}…` : name;
  return `№${agrNo} ${short}`;
}

/**
 * Maps the worst severity in a violation group to the action label shown in
 * the message: Грубое → Строгий выговор, Критичное → Выговор, else Предупреждение.
 */
function worstViolationAction(sevMap: Map<string, number>): string {
  for (const sev of sevMap.keys()) {
    const s = sev.toLowerCase();
    if (s.includes("груб")) return "Строгий выговор";
    if (s.includes("критич")) return "Выговор";
  }
  return "Предупреждение";
}

/** "3 средних" / "1 среднее" / "2 критичных" — severity with a Russian count form. */
function fmtSeverityCount(severity: string, n: number): string {
  const s = severity.toLowerCase();
  const forms: [RegExp, string, string][] = [
    [/сред/, "среднее", "средних"],
    [/критич/, "критичное", "критичных"],
    [/груб/, "грубое", "грубых"],
  ];
  for (const [re, one, many] of forms) {
    if (re.test(s)) return `${n} ${n === 1 ? one : many}`;
  }
  return `${n} ${s}`;
}

/** "10 000" — dram amount with space thousand separators. */
function fmtDram(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Daily accounting report message — compact, two-group format (отзыв
 * руководителя, июль 2026): all accountants are shown, but the clean ones are
 * collapsed into a single names list and only the violators get a detailed
 * breakdown, so «Нарушения: нет» is never repeated per person:
 *
 *   Ежедневный отчет бухгалтерии
 *
 *   Дата: 13.07
 *
 *   Общий уровень сервиса: 84% по отделу
 *
 *   Звезда дня
 *
 *   ⭐️ Имя: 100% оценка
 *
 *   Бухгалтеры без нарушений:
 *   Դավիթ, Հասմիկ, Նաիրա
 *
 *   Бухгалтеры с нарушениями:
 *   Գայանե
 *   - B-1234 — поздний ответ — предупреждение / 0 др
 *   - B-5678 — без ответа — 1 000 др
 *
 * Money is the simple daily rule — 1st violation per accountant/day =
 * предупреждение (0 др), every next = 1 000 др (hard cap 1 000; severity/AI
 * never sets the amount). Violations passed in must already be Margarita's
 * confirmed rows.
 */
/** One top-scoring accountant shown in the «Звезда дня» block. */
export interface DailyReportStar {
  accountant: string;
  avgScore: number;
}

/** One нарушение line under an accountant: chat code — problem — fine. */
export interface DailyReportViolItem {
  code: string;
  /**
   * Название чата / имя клиента для этого нарушения — чтобы бухгалтер сразу узнал
   * чат, а не только номер договора (запрос QA). Берётся из `client` нарушения
   * (при добавлении из сетки оценки туда кладётся имя чата).
   */
  name: string | null;
  type: string;
  fine: number;
  /** Комментарий Маргариты к нарушению — показываем в отчёте (запрос QA, 2-й раз). */
  note: string | null;
}

/** One accountant WITH нарушения: name, their request count, and нарушения. */
export interface DailyReportRow {
  accountant: string;
  count: number;
  violations: DailyReportViolItem[];
}

/**
 * Structured body of the daily accounting report, rendered as the Telegram
 * message (buildReportMessage) AND as the editable/approved report shown to
 * accountants (PublishReportBox → mqa_published_reports). The PDF was retired;
 * this ONE model keeps the service %, «Звезда дня» and the нарушения priced by
 * the single fine engine (groupNarusheniya) consistent everywhere. Changing the
 * daily report means changing this model once — both outputs follow, so PDF and
 * message can never drift apart.
 *
 * Формат (по отзыву руководителя, июль 2026): показываем ВСЕХ бухгалтеров, но
 * компактно — тех, у кого нарушений нет, одним списком имён; тех, у кого есть, —
 * детально (имя + нарушения). Строку «Нарушения: нет» по каждому больше не
 * пишем, чтобы отчёт был компактным и читаемым.
 */
export interface DailyReportModel {
  /** Header date / period label, e.g. "15.07" or "13.07 — 15.07". */
  dateLabel: string;
  /** «Общий уровень сервиса» percent for the department. */
  servicePct: number;
  /**
   * Были ли вообще проверки (оценки) за период. Когда нет — «Общий уровень
   * сервиса» показывается как «—», а не «0%» (иначе пустой день читается как
   * катастрофический сервис — жалоба Маргариты: «0% не соответствует данным»).
   */
  serviceHasData: boolean;
  /** Проверено чатов (QA) по каждому бухгалтеру — только у кого > 0. */
  checkedByAccountant: { accountant: string; chats: number }[];
  /** Звёзды дня — top-scoring accountants (roster only). */
  stars: DailyReportStar[];
  /** Бухгалтеры С нарушениями — имя + их нарушения (только нарушители). */
  rows: DailyReportRow[];
  /**
   * Бухгалтеры БЕЗ нарушений — только имена (компактный список). С ростером это
   * все действующие бухгалтеры, у кого за день нет нарушений; без ростера — те,
   * у кого были запросы за день и нет нарушений.
   */
  cleanAccountants: string[];
  /** Sum of all fines in the window (др). */
  totalFine: number;
}

/**
 * Compute the shared daily-report model from the aggregate report + the
 * window's confirmed violations and per-accountant request counts. Money uses
 * the single groupNarusheniya engine (1-е нарушение за день — предупреждение /
 * 0 др, каждое следующее — 1 000 др, ручная санкция перебивает), exactly like
 * the PDF and the dashboard, so the figures always match.
 */
export function buildDailyReportModel(
  report: DailyReport,
  options: ReportMessageOptions = {}
): DailyReportModel {
  const { serviceQualityPct, perAccountant, filters } = report;
  const { violations = [], roster, requests } = options;
  const dateISO =
    options.date ??
    filters.to ??
    filters.from ??
    new Date().toISOString().slice(0, 10);
  const rosterSet = roster && roster.length > 0 ? new Set(roster) : null;
  const inRoster = (name: string) => !rosterSet || rosterSet.has(name);

  // Бухгалтеры с ПОДТВЕРЖДЁННЫМ критичным нарушением (mqa_violations, severity
  // «Критичное»/gross). Оценка чата (avgScore) и нарушение живут в РАЗНЫХ
  // таблицах, поэтому бухгалтер с критичным нарушением, но оценками 100, раньше
  // показывался «Звездой дня» с сервисом 100% (жалоба Маргариты про Тагуи).
  // Такой человек НЕ может быть звездой дня.
  const criticalAccts = new Set<string>();
  for (const v of violations) {
    if (v.confirmed === false) continue;
    if (/критич/i.test(v.severity ?? "") || v.gross) {
      const a = v.accountant?.trim();
      if (a) criticalAccts.add(a);
    }
  }

  // ── Stars of the day (roster only; never someone with a critical violation) ─
  const scored = perAccountant.filter(
    (a) =>
      a.count > 0 &&
      a.avgScore >= 0 &&
      inRoster(a.accountant) &&
      !criticalAccts.has(a.accountant.trim())
  );
  const topScore = scored.reduce((m, a) => Math.max(m, a.avgScore), 0);
  const perfect = scored.filter((a) => a.avgScore === 100);
  const starList = perfect.length
    ? perfect
    : topScore > 0
      ? scored.filter((a) => a.avgScore === topScore)
      : [];
  const stars: DailyReportStar[] = starList.map((s) => ({
    accountant: s.accountant,
    avgScore: s.avgScore,
  }));

  // Проверено чатов (QA) по бухгалтерам — из per-accountant chatsChecked; только
  // те, у кого > 0, отсортированы по убыванию (roster-фильтр как у звёзд).
  const checkedByAccountant = perAccountant
    .filter((a) => a.chatsChecked > 0 && inRoster(a.accountant))
    .map((a) => ({ accountant: a.accountant, chats: a.chatsChecked }))
    .sort((x, y) => y.chats - x.chats || x.accountant.localeCompare(y.accountant));

  // ── Нарушения per accountant (single fine engine — matches PDF/dashboard) ──
  // Деньги — единое правило Маргариты (groupNarusheniya, тот же, что PDF/дашборд):
  //   • 1-е нарушение бухгалтера за ДЕНЬ → предупреждение / 0 др;
  //   • 2-е и каждое следующее за тот же день → 1 000 др;
  //   • ручная санкция (> 0) перебивает. Один чат = одно нарушение.
  const violByAcc = new Map<string, DailyReportViolItem[]>();
  let totalFine = 0;
  for (const n of groupNarusheniya(
    violations.map((v) => ({
      vdate: v.vdate,
      accountant: v.accountant,
      severity: v.severity,
      sanction: v.sanction,
      chat_agr_no: v.chat_agr_no,
      client: v.client,
      violation_type: v.violation_type,
    }))
  )) {
    const acc = n.accountant?.trim() || "-";
    totalFine += n.fine;
    const list = violByAcc.get(acc) ?? [];
    const code = n.chat_agr_no?.trim() || n.client?.trim() || "-";
    // Название чата / клиента рядом с номером договора. Не дублируем, если оно
    // совпадает с тем, что уже показано как код.
    const name = n.client?.trim() || null;
    // Комментарий берём из исходной строки нарушения (репрезентативная — первая
    // в группе), тем же приёмом, что и в остальных отчётах.
    const note = violations[n.rowIndexes[0]]?.note?.trim() || null;
    list.push({
      code,
      name: name && name !== code ? name : null,
      type: n.types.join(", ") || "-",
      fine: n.fine,
      note,
    });
    violByAcc.set(acc, list);
  }

  // Request figure per accountant = UNIQUE client chats in the reporting scope.
  const reqByAcc = new Map<string, number>();
  for (const r of requests ?? []) {
    reqByAcc.set(r.accountant, r.count);
  }

  // Бухгалтеры С нарушениями — детально (имя + нарушения). С ростером — в
  // порядке ростера, плюс нарушители вне ростера (напр. «-»); без ростера — в
  // порядке появления нарушений.
  const rows: DailyReportRow[] = [];
  const seenViol = new Set<string>();
  const addViol = (name: string) => {
    if (seenViol.has(name)) return;
    seenViol.add(name);
    rows.push({
      accountant: name,
      count: reqByAcc.get(name) ?? 0,
      violations: violByAcc.get(name) ?? [],
    });
  };
  if (rosterSet) {
    for (const n of roster!) if (violByAcc.has(n)) addViol(n);
    for (const acc of violByAcc.keys()) if (!rosterSet.has(acc)) addViol(acc);
  } else {
    for (const acc of violByAcc.keys()) addViol(acc);
  }

  // Бухгалтеры БЕЗ нарушений — только имена. С ростером показываем ВСЕХ
  // действующих бухгалтеров без нарушений; без ростера — тех, у кого были
  // запросы за день и нет нарушений.
  const cleanAccountants: string[] = [];
  if (rosterSet) {
    for (const n of roster!) if (!violByAcc.has(n)) cleanAccountants.push(n);
  } else {
    const seenClean = new Set<string>();
    for (const r of requests ?? []) {
      if (r.count > 0 && !violByAcc.has(r.accountant) && !seenClean.has(r.accountant)) {
        seenClean.add(r.accountant);
        cleanAccountants.push(r.accountant);
      }
    }
  }

  return {
    dateLabel: periodHeader(report, dateISO),
    servicePct: serviceQualityPct,
    serviceHasData: (report.totals?.evaluatedChats ?? 0) > 0,
    checkedByAccountant,
    stars,
    rows,
    cleanAccountants,
    totalFine,
  };
}

/** Money label for one нарушение: «N др» or «предупреждение / 0 др». */
export function dailyFineLabel(fine: number): string {
  return fine > 0 ? `${fmtDram(fine)} др` : "предупреждение / 0 др";
}

/**
 * Daily accounting report message — matches the format the department sends,
 * with each accountant's violations merged directly UNDER their request count.
 * A thin text renderer over `buildDailyReportModel`; the daily PDF renders the
 * SAME model, so the message and the PDF always show identical figures.
 */
export function buildReportMessage(
  report: DailyReport,
  options: ReportMessageOptions = {}
): string {
  const model = buildDailyReportModel(report, options);
  const { sheetUrl } = options;
  const lines: string[] = [];

  lines.push("Ежедневный отчет бухгалтерии");
  lines.push("");
  lines.push(`Дата: ${model.dateLabel}`);
  lines.push("");
  lines.push(
    model.serviceHasData
      ? `Общий уровень сервиса: ${model.servicePct}% по отделу`
      : `Общий уровень сервиса: — (нет проверок за период)`
  );

  // Проверено чатов (QA) по бухгалтерам — сколько чатов прошло проверку у каждого
  // (запрос Маргариты: «в отчёте не отображается количество чатов, прошедших QA,
  // по каждому бухгалтеру»).
  if (model.checkedByAccountant.length > 0) {
    lines.push("");
    lines.push("Проверено чатов (QA):");
    for (const c of model.checkedByAccountant) {
      lines.push(`- ${c.accountant}: ${c.chats}`);
    }
  }

  if (model.stars.length) {
    lines.push("");
    lines.push("Звезда дня");
    lines.push("");
    for (const s of model.stars) {
      lines.push(`⭐️ ${s.accountant}: ${s.avgScore}% оценка`);
    }
  }

  // Бухгалтеры без нарушений — компактным списком имён.
  if (model.cleanAccountants.length > 0) {
    lines.push("");
    lines.push("Бухгалтеры без нарушений:");
    lines.push(model.cleanAccountants.join(", "));
  }

  // Бухгалтеры с нарушениями — имя, затем нарушения (код — тип — штраф).
  if (model.rows.length > 0) {
    lines.push("");
    lines.push("Бухгалтеры с нарушениями:");
    model.rows.forEach((row, i) => {
      if (i > 0) lines.push("");
      lines.push(row.accountant);
      for (const item of row.violations) {
        // Номер договора + НАЗВАНИЕ чата, чтобы бухгалтер сразу узнал чат.
        const label = item.name ? `${item.code} (${item.name})` : item.code;
        lines.push(`- ${label} — ${item.type} — ${dailyFineLabel(item.fine)}`);
        // Комментарий Маргариты — отдельной строкой под нарушением, если есть.
        if (item.note) lines.push(`  💬 ${item.note}`);
      }
    });
    if (model.totalFine > 0) {
      lines.push("");
      lines.push(`Итого штрафов: ${fmtDram(model.totalFine)} др`);
    }
  }

  if (sheetUrl) {
    lines.push("");
    lines.push(`🔗 ${sheetUrl}`);
  }

  return lines.join("\n");
}

/** "1 чат / 2 чата / 5 чатов" — Russian count form. */
function fmtChatCount(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return `${n} чат`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} чата`;
  return `${n} чатов`;
}

export interface PeriodSummaryOptions {
  /** Сколько строк максимум в блоке «Требуют внимания» (по умолчанию 3). */
  maxAttention?: number;
}

/**
 * Краткий Telegram-отчёт по QA за выбранный период (запрос руководства). Один
 * компактный, читаемый текст — БЕЗ длинных списков: период, сколько бухгалтеров/
 * чатов проверено, средняя оценка, лучший результат, требующие внимания,
 * нарушения и апелляции (подтверждено / отклонено). Все цифры — из
 * `buildAnalytics` (реальные записи БД), поэтому совпадают с дашбордом.
 *
 *   Отчёт по QA за 01.07.2026–31.07.2026
 *
 *   Проверено бухгалтеров: 12
 *   Проверено чатов: 348
 *   Средняя оценка: 84%
 *
 *   Лучший результат:
 *   — Имя — 96%, проверено 42 чата
 *
 *   Требуют внимания:
 *   — Имя — 61%, 8 нарушений
 *
 *   Нарушения: 27
 *   Апелляции: 9
 *   Подтверждено: 4
 *   Отклонено: 5
 */
export function buildPeriodSummaryMessage(
  analytics: AnalyticsReport,
  options: PeriodSummaryOptions = {}
): string {
  const { maxAttention = 3 } = options;
  const { totals, perAccountant, rankings, period } = analytics;
  const lines: string[] = [];

  lines.push(`Отчёт по QA за ${period.label}`);
  lines.push("");

  if (totals.evaluations === 0) {
    lines.push("За выбранный период проверок QA не было.");
    if (totals.violations > 0) lines.push(`Нарушения: ${totals.violations}`);
    if (totals.appeals > 0) lines.push(`Апелляции: ${totals.appeals}`);
    return lines.join("\n");
  }

  lines.push(`Проверено бухгалтеров: ${totals.accountantsReviewed}`);
  lines.push(`Проверено чатов: ${totals.chatsChecked}`);
  lines.push(
    `Средняя оценка: ${totals.avgScore >= 0 ? `${totals.avgScore}%` : "—"}`
  );

  // Лучший результат — по средней (с достаточной выборкой), с числом чатов.
  const best = rankings.topByScore;
  if (best) {
    const row = perAccountant.find((a) => a.accountant === best.accountant);
    lines.push("");
    lines.push("Лучший результат:");
    const chats = row ? `, проверено ${fmtChatCount(row.chatsChecked)}` : "";
    lines.push(`— ${best.accountant} — ${best.value}%${chats}`);
  }

  // Требуют внимания — слабая средняя (< 80%) или есть нарушения; максимум N.
  // Не делаем громких выводов по крошечной выборке: сортируем по «худшести»,
  // но выводим оценку как есть и нарушения как есть (реальные данные).
  const attention = perAccountant
    .filter((a) => (a.avgScore >= 0 && a.avgScore < 80) || a.violations > 0)
    .filter((a) => a.accountant !== best?.accountant)
    .sort(
      (x, y) =>
        (x.avgScore < 0 ? 101 : x.avgScore) - (y.avgScore < 0 ? 101 : y.avgScore) ||
        y.violations - x.violations
    )
    .slice(0, maxAttention);
  if (attention.length) {
    lines.push("");
    lines.push("Требуют внимания:");
    for (const a of attention) {
      const parts: string[] = [];
      if (a.avgScore >= 0) parts.push(`${a.avgScore}%`);
      if (a.violations > 0) parts.push(fmtViolationCount(a.violations));
      lines.push(`— ${a.accountant} — ${parts.join(", ")}`);
    }
  }

  lines.push("");
  lines.push(`Нарушения: ${totals.violations}`);
  lines.push(`Апелляции: ${totals.appeals}`);
  if (totals.appeals > 0) {
    lines.push(`Подтверждено: ${totals.appealsApproved}`);
    lines.push(`Отклонено: ${totals.appealsRejected}`);
    if (totals.appealsPending > 0) lines.push(`Ожидают: ${totals.appealsPending}`);
  }

  return lines.join("\n");
}

/** "1 нарушение / 3 нарушения / 7 нарушений" — Russian count form. */
function fmtViolationCount(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return `${n} нарушение`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} нарушения`;
  return `${n} нарушений`;
}

export interface FridayFinesOptions {
  /** ISO Monday and Friday (or today) of the reported week. */
  weekFrom: string;
  weekTo: string;
  /** Month-to-date fine totals per accountant («итого за месяц»). */
  monthFineTotals?: Record<string, number>;
  /** Canonical roster — used for the «Без нарушений» line. */
  roster?: string[];
  /** This-year Грубое counts per accountant BEFORE the week (escalation). */
  grossPrior?: Record<string, number>;
}

/**
 * «Пятничный отчёт» — the weekly fines review Margarita sends on Fridays so
 * everyone sees their штрафы for the week and she can control the totals:
 *
 *   Пятничный отчет по штрафам
 *
 *   Неделя: 30.06 — 04.07
 *
 *   — Лилит: 1 000 др + Предупреждение (3 средних) /итого за месяц 7 000 драм/
 *   — Аваг: 2 000 др + Предупреждение (1 среднее) /итого за месяц 20 000 драм/ причина
 *
 *   Итого за неделю: 4 нарушения, штрафы 3 000 драм
 *
 *   Без нарушений: ✅ Имя, Имя, Имя
 */
export function buildFridayFinesMessage(
  weekViolations: Violation[],
  options: FridayFinesOptions
): string {
  const { weekFrom, weekTo, monthFineTotals = {}, roster = [], grossPrior } = options;
  const lines: string[] = [];

  lines.push("Пятничный отчет по штрафам");
  lines.push("");
  lines.push(`Неделя: ${fmtDay(weekFrom)} — ${fmtDay(weekTo)}`);

  const withAcc = weekViolations.filter((v) => v.accountant);
  // One нарушение = one chat/week (worst severity, fined once) — «за каждый чат».
  const narusheniya = groupNarusheniya(withAcc, { grossPrior });
  const byAcc = new Map<
    string,
    { sevMap: Map<string, number>; fine: number; count: number; reasons: string[] }
  >();
  for (const n of narusheniya) {
    const acc = n.accountant;
    const entry =
      byAcc.get(acc) ??
      { sevMap: new Map<string, number>(), fine: 0, count: 0, reasons: [] };
    entry.sevMap.set(n.severity, (entry.sevMap.get(n.severity) ?? 0) + 1);
    entry.count += 1;
    entry.fine += n.fine;
    for (const reason of n.types) {
      if (reason && !entry.reasons.includes(reason)) entry.reasons.push(reason);
    }
    byAcc.set(acc, entry);
  }

  if (byAcc.size === 0) {
    lines.push("");
    lines.push("На этой неделе нарушений нет ✅");
  } else {
    lines.push("");
    // Biggest weekly fine first — the people Margarita should look at.
    const entries = [...byAcc.entries()].sort(
      (a, b) => b[1].fine - a[1].fine || b[1].count - a[1].count
    );
    let totalFine = 0;
    let totalCount = 0;
    for (const [acc, { sevMap, fine, count, reasons }] of entries) {
      totalFine += fine;
      totalCount += count;
      const action = worstViolationAction(sevMap);
      const sevParts = [...sevMap.entries()]
        .map(([sev, n]) => fmtSeverityCount(sev, n))
        .join(", ");
      const finePrefix = fine > 0 ? `${fmtDram(fine)} др + ` : "";
      const monthTotal = monthFineTotals[acc] ?? fine;
      const totalSuffix =
        monthTotal > 0 ? ` /итого за месяц ${fmtDram(monthTotal)} драм/` : "";
      const reasonSuffix = reasons.length ? ` ${reasons.join("; ")}` : "";
      lines.push(`— ${acc}: ${finePrefix}${action} (${sevParts})${totalSuffix}${reasonSuffix}`);
    }
    lines.push("");
    lines.push(
      `Итого за неделю: ${fmtViolationCount(totalCount)}, штрафы ${fmtDram(totalFine)} драм`
    );
  }

  // Who kept the week clean — the positive side of the review.
  const violators = new Set(byAcc.keys());
  const clean = roster.filter((name) => !violators.has(name));
  if (clean.length > 0) {
    lines.push("");
    lines.push(`Без нарушений: ✅ ${clean.join(", ")}`);
  }

  return lines.join("\n");
}

export interface MonthlyFinesOptions {
  /** ISO first day of the month and the last reported day (month-to-date). */
  monthFrom: string;
  monthTo: string;
  /** Canonical roster — used for the «Без нарушений» line. */
  roster?: string[];
  /** This-year Грубое counts per accountant BEFORE the month (escalation). */
  grossPrior?: Record<string, number>;
}

/**
 * «Ежемесячный отчёт по штрафам» — the monthly fines review: one block per
 * person listing every штраф of the month (chat code — problem — money), then
 * the grand totals:
 *
 *   Ежемесячный отчет по штрафам
 *
 *   Месяц: 01.07 — 31.07
 *
 *   — Лилит:
 *     ▸ B-4742 — Долгий ответ — 1 000 др
 *     ▸ B-5110 — Грубый ответ — 2 000 др
 *     Итого: 3 000 др
 *
 *   — Аваг:
 *     ▸ B-1234 — Просрочка отчетности — предупреждение
 *     Итого: 0 др
 *
 *   Сумма всех штрафов: 3 000 др
 *   Финальный штраф: 3 000 др
 *
 *   Без нарушений: ✅ Имя, Имя
 *
 * Money comes from the same «Условия» rules as the Friday report
 * (groupNarusheniya — одно нарушение на чат за неделю, ручная санкция
 * перебивает), so the monthly figures always match the «итого за месяц» totals
 * shown there. A chat with several problems is ONE строка, fined once.
 */
export function buildMonthlyFinesMessage(
  monthViolations: Violation[],
  options: MonthlyFinesOptions
): string {
  const { monthFrom, monthTo, roster = [], grossPrior } = options;
  const lines: string[] = [];

  lines.push("Ежемесячный отчет по штрафам");
  lines.push("");
  lines.push(`Месяц: ${fmtDay(monthFrom)} — ${fmtDay(monthTo)}`);

  const withAcc = monthViolations.filter((v) => v.accountant);
  // One block per нарушение (chat/week collapsed, worst severity, fined once).
  const narusheniya = groupNarusheniya(withAcc, { grossPrior });
  const byAcc = new Map<
    string,
    { items: { code: string; reason: string; fine: number }[]; total: number }
  >();
  for (const n of narusheniya) {
    const acc = n.accountant;
    const entry = byAcc.get(acc) ?? { items: [], total: 0 };
    entry.items.push({
      code: n.chat_agr_no?.trim() || "-",
      reason: n.types.join(", ") || "-",
      fine: n.fine,
    });
    entry.total += n.fine;
    byAcc.set(acc, entry);
  }

  if (byAcc.size === 0) {
    lines.push("");
    lines.push("В этом месяце нарушений нет ✅");
  } else {
    // Biggest monthly fine first — the people Margarita should look at.
    const entries = [...byAcc.entries()].sort(
      (a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])
    );
    let grandTotal = 0;
    for (const [acc, { items, total }] of entries) {
      grandTotal += total;
      lines.push("");
      lines.push(`— ${acc}:`);
      for (const item of items) {
        const money = item.fine > 0 ? `${fmtDram(item.fine)} др` : "предупреждение";
        lines.push(`  ▸ ${item.code} — ${item.reason} — ${money}`);
      }
      lines.push(`  Итого: ${fmtDram(total)} др`);
    }
    lines.push("");
    lines.push(`Сумма всех штрафов: ${fmtDram(grandTotal)} др`);
    lines.push(`Финальный штраф: ${fmtDram(grandTotal)} др`);
  }

  // Who kept the month clean — the positive side of the review.
  const violators = new Set(byAcc.keys());
  const clean = roster.filter((name) => !violators.has(name));
  if (clean.length > 0) {
    lines.push("");
    lines.push(`Без нарушений: ✅ ${clean.join(", ")}`);
  }

  return lines.join("\n");
}

export interface WeeklyFinesBreakdownOptions {
  weekFrom: string;
  weekTo: string;
  /** This-year Грубое counts per accountant BEFORE the week (escalation). */
  grossPrior?: Record<string, number>;
  /**
   * Полный список действующих сотрудников. Когда задан, блок показывает ВСЕХ
   * бухгалтеров: сначала те, у кого есть нарушения (как раньше — по убыванию
   * штрафа), затем остальные строкой «— Имя: без нарушений» в порядке ростера.
   * Без ростера поведение прежнее — только нарушители.
   */
  roster?: string[];
}

/**
 * Индивидуальная разбивка нарушений ЗА НЕДЕЛЮ по каждому бухгалтеру — блок для
 * вставки в ежедневный отчёт. Формат как в ежемесячном («— Имя:» → «▸ код —
 * тип — сумма» → «Итого: N др»). Суммы по правилам «Условия» через
 * groupNarusheniya (одно нарушение — ОДИН чат за неделю, худшая тяжесть, штраф
 * один раз: 1-й чат за неделю — предупреждение, 2-й и далее — 1 000 др за каждый
 * чат, критичное — 2 000, грубое — эскалация; ручная санкция перебивает). С
 * `roster` в блок попадают ВСЕ
 * сотрудники (у кого нет нарушений — строкой «без нарушений»); без ростера —
 * только нарушители, и пустая строка, если нарушений нет. Фильтрацию по
 * валидным сотрудникам делает вызывающая сторона.
 */
export function buildWeeklyFinesBreakdown(
  weekViolations: Violation[],
  options: WeeklyFinesBreakdownOptions
): string {
  const { weekFrom, weekTo, grossPrior, roster } = options;
  const hasRoster = Boolean(roster && roster.length > 0);
  const withAcc = weekViolations.filter((v) => v.accountant);
  if (withAcc.length === 0 && !hasRoster) return "";

  // One line per нарушение (chat/week collapsed, worst severity, fined once).
  const narusheniya = groupNarusheniya(withAcc, { grossPrior });
  const byAcc = new Map<
    string,
    { items: { code: string; reason: string; fine: number }[]; total: number }
  >();
  for (const n of narusheniya) {
    const acc = n.accountant;
    const entry = byAcc.get(acc) ?? { items: [], total: 0 };
    entry.items.push({
      code: n.chat_agr_no?.trim() || "-",
      reason: n.types.join(", ") || "-",
      fine: n.fine,
    });
    entry.total += n.fine;
    byAcc.set(acc, entry);
  }
  if (byAcc.size === 0 && !hasRoster) return "";

  const lines: string[] = [];
  lines.push(`Нарушения за неделю (${fmtDay(weekFrom)} — ${fmtDay(weekTo)}):`);
  // Больший штраф — выше.
  const entries = [...byAcc.entries()].sort(
    (a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])
  );
  for (const [acc, { items, total }] of entries) {
    lines.push("");
    lines.push(`— ${acc}:`);
    for (const item of items) {
      const money = item.fine > 0 ? `${fmtDram(item.fine)} др` : "предупреждение";
      lines.push(`  ▸ ${item.code} — ${item.reason} — ${money}`);
    }
    lines.push(`  Итого: ${fmtDram(total)} др`);
  }

  // Остальные сотрудники ростера, у кого за неделю нарушений нет.
  if (hasRoster) {
    const violators = new Set(byAcc.keys());
    for (const name of roster!) {
      if (violators.has(name)) continue;
      lines.push("");
      lines.push(`— ${name}: без нарушений`);
    }
  }

  return lines.join("\n");
}

/**
 * Недельная история нарушений по ДНЯМ (п.10) — для раздела «Сообщения», чтобы
 * руководство видело нарушения за каждый день недели. Показываются только дни, в
 * которых есть нарушения. По каждому чату — ОДНА строка (несколько нарушений по
 * чату за день объединены через запятую): клиент/чат, бухгалтер, типы,
 * предупреждение/штраф с суммой и комментарий. Границы дней — Ереван (даты уже
 * приходят как Yerevan-ISO из вызывающей стороны). Суммы считаются тем же
 * движком `groupNarusheniya`, что дашборд/PDF, поэтому недельный итог совпадает.
 * Только подтверждённые ручные нарушения (confirmed !== false).
 */
export function buildWeeklyViolationHistory(
  weekViolations: Violation[],
  options: { weekFrom: string; weekTo: string }
): string {
  const { weekFrom, weekTo } = options;
  const confirmed = weekViolations.filter((v) => v.confirmed !== false);
  const fineInput = confirmed.map((v) => ({
    vdate: v.vdate,
    accountant: v.accountant,
    severity: v.gross ? "Грубое" : v.severity,
    sanction: v.sanction,
    chat_agr_no: v.chat_agr_no,
    client: v.client,
    violation_type: v.violation_type,
  }));
  const narusheniya = groupNarusheniya(fineInput);

  const byDay = new Map<string, typeof narusheniya>();
  for (const n of narusheniya) {
    const day = (n.vdate ?? "").slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(n);
  }

  const lines: string[] = [];
  lines.push(`История нарушений за неделю (${fmtDay(weekFrom)} — ${fmtDay(weekTo)}):`);
  if (byDay.size === 0) {
    lines.push("");
    lines.push("Нет нарушений за неделю");
    return lines.join("\n");
  }

  let weekTotal = 0;
  let weekCount = 0;
  for (const day of [...byDay.keys()].sort()) {
    const items = byDay.get(day)!;
    lines.push("");
    lines.push(`▸ ${fmtFullDay(day)}`);
    for (const n of items) {
      weekCount += 1;
      weekTotal += n.fine;
      const who = n.accountant?.trim() || "—";
      const target = n.client?.trim() || n.chat_agr_no?.trim() || "—";
      const code = n.chat_agr_no && n.client ? ` (${n.chat_agr_no})` : "";
      const types = n.types.join(", ") || "—";
      const money = n.fine > 0 ? `${fmtDram(n.fine)} др` : "предупреждение";
      const note = confirmed[n.rowIndexes[0]]?.note?.trim();
      const noteStr = note ? ` — «${note}»` : "";
      lines.push(`  • ${target}${code} · ${who} · ${types} · ${money}${noteStr}`);
    }
  }
  lines.push("");
  lines.push(`Итого за неделю: ${weekCount} нарушений, штрафы ${fmtDram(weekTotal)} др`);
  return lines.join("\n");
}

/**
 * Telegram-ready mailing-compliance report (файл-2). Grouped by accountant, each
 * category on its own line with «Статус — N» pairs. Zero-count statuses and
 * empty accountants/categories are omitted; consistent names/capitalization; the
 * period is shown at the top. Uses the SAME canonical report object as the
 * dashboard/PDF (buildMailingCompliance), so the numbers always agree.
 */
export function buildMailingComplianceMessage(
  report: MailingComplianceReport,
  options: { periodLabel?: string } = {}
): string {
  const lines: string[] = [];
  lines.push("Отчёт по рассылкам");
  lines.push("");
  lines.push(`Период: ${options.periodLabel ?? report.period}`);

  const grand: Record<string, number> = {};
  let shownAccountants = 0;
  for (const acc of report.perAccountant) {
    const catsWithData = acc.categories.filter((c) => c.statuses.length > 0);
    if (catsWithData.length === 0) continue; // skip empty accountants
    shownAccountants += 1;
    lines.push("");
    lines.push(acc.accountant);
    for (const cat of catsWithData) {
      lines.push(cat.label);
      const pairs = cat.statuses
        .filter((s) => s.count > 0)
        .map((s) => {
          grand[cat.label] = (grand[cat.label] ?? 0) + s.count;
          return `${s.status} — ${s.count}`;
        });
      lines.push(pairs.join("  "));
    }
  }

  if (shownAccountants === 0) {
    lines.push("");
    lines.push("Нет данных по рассылкам за период");
  }
  return lines.join("\n");
}

/** dd.mm.yyyy — full date for the standalone daily / reconciliation reports. */
function fmtFullDay(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

export interface DailyStaffViolationsOptions {
  /** ISO date отчётного дня (или последнего дня окна). */
  date?: string;
  /**
   * Менеджер по коду чата (mqa_chats.manager). Нет записи / пусто → «не указан».
   * Менеджеров НЕ выдумываем — показываем только то, что реально есть в данных.
   */
  managerByChat?: Record<string, string | null>;
}

/**
 * Ежедневный отчёт по нарушениям ПО КАЖДОМУ СОТРУДНИКУ. В отличие от блока
 * «Нарушения» в основном отчёте (buildReportMessage), здесь видна полная
 * картина: перечислены ВСЕ сотрудники ростера, включая тех, у кого за день 0
 * нарушений («Имя — 0 нарушений»). По каждому нарушению показываются клиент/чат,
 * тип, штраф (или «предупреждение»), комментарий, статус подтверждения и
 * менеджер (если он есть в данных чата, иначе «не указан»).
 *
 * Источник и суммы — те же, что на дашборде: `buildLiveViolationBreakdown`
 * (живые mqa_violations, правило warning/penalty из violations.ts). Никакой
 * новой логики расчёта здесь нет — только другой формат вывода.
 */
export function buildDailyStaffViolationsMessage(
  report: ViolationReport,
  options: DailyStaffViolationsOptions = {}
): string {
  const { managerByChat } = options;
  const dateISO = options.date ?? new Date().toISOString().slice(0, 10);
  const managerFor = (chatCode: string | null): string => {
    const raw = chatCode ? managerByChat?.[chatCode] : null;
    const m = (raw ?? "").trim();
    return m || "не указан";
  };

  const lines: string[] = [];
  lines.push("Ежедневный отчёт по нарушениям (по сотрудникам)");
  lines.push("");
  lines.push(`Дата: ${fmtFullDay(dateISO)}`);
  lines.push("");
  const s = report.summary;
  lines.push(
    `Всего нарушений: ${s.violations} · предупреждений: ${s.warnings} · ` +
      `штрафов: ${s.penalties} · сумма: ${fmtDram(s.fineTotal)} др`
  );

  // Сотрудники без нарушений не выводятся (п.9). Если нарушений нет вовсе —
  // один общий пустой статус на всю секцию, без строк по каждому сотруднику.
  if (report.perAccountant.length === 0) {
    lines.push("");
    lines.push("Нет нарушений за выбранный период");
    return lines.join("\n");
  }

  for (const g of report.perAccountant) {
    lines.push("");
    lines.push(`— ${g.employeeFull} — ${fmtViolationCount(g.count)}`);
    for (const l of g.lines) {
      const client = l.client?.trim();
      const clientLabel = client || l.chatCode || "—";
      const chatSuffix = l.chatCode && client ? ` (${l.chatCode})` : "";
      lines.push(`  ▸ Клиент: ${clientLabel}${chatSuffix}`);
      const critMark = l.critical || l.gross ? " ⚠ критично" : "";
      lines.push(`    Нарушение: ${l.type ?? "—"}${critMark}`);
      const money = l.amount > 0 ? `${fmtDram(l.amount)} др` : "предупреждение";
      lines.push(`    Штраф: ${money}`);
      if (l.note && l.note.trim()) lines.push(`    Комментарий: ${l.note.trim()}`);
      const statusParts: string[] = [l.confirmed ? "подтверждено" : "не подтверждено"];
      if (l.appealStatus === "appealed") statusParts.push("апелляция");
      else if (l.appealStatus === "approved") statusParts.push("апелляция одобрена");
      else if (l.appealStatus === "rejected") statusParts.push("апелляция отклонена");
      lines.push(`    Статус: ${statusParts.join(" · ")}`);
      lines.push(`    Менеджер: ${managerFor(l.chatCode)}`);
    }
  }

  return lines.join("\n");
}

/** Append "    + ещё N" when a list was truncated to `shown`. */
function overflow(lines: string[], total: number, shown: number): void {
  if (total > shown) lines.push(`    + ещё ${total - shown}`);
}

/**
 * A message addressed to ONE accountant, ready to copy and send them directly
 * (item 11 — Margarita copies a per-person message, not the whole roster). Leads
 * with their service %, then their critical chats with the concrete reason, then
 * their weaker chats. This is what she sends "сразу" per the boss's note.
 */
export function buildAccountantMessage(
  report: DailyReport,
  accountant: string,
  options: { date?: string } = {}
): string {
  const dateISO =
    options.date ??
    report.filters.to ??
    report.filters.from ??
    new Date().toISOString().slice(0, 10);
  const acc = report.perAccountant.find((a) => a.accountant === accountant);
  const crit = report.criticalChats.filter((c) => c.accountant === accountant);

  const lines: string[] = [];
  lines.push(`👤 ${accountant}`);
  lines.push(`🗓 ${fmtDay(dateISO)}`);
  if (acc && acc.count > 0 && acc.avgScore >= 0) {
    const emoji = BAND_EMOJI[bandFor(acc.avgScore)];
    lines.push(
      `${emoji} Сервис: ${acc.avgScore}% — ${bandFor(acc.avgScore)} (оценено чатов: ${acc.count})`
    );
  }

  if (crit.length) {
    const critCap = 10;
    lines.push("");
    lines.push(`⛔️ Критичные чаты (${crit.length}):`);
    for (const c of crit.slice(0, critCap)) {
      const why = c.reasons.length ? `: ${c.reasons.join("; ")}` : ` (оценка ${c.score}%)`;
      lines.push(`• ${chatLabel(c.chat_agr_no, c.chat_name)}${why}`);
    }
    overflow(lines, crit.length, critCap);
  } else if (acc && acc.lowCount > 0) {
    lines.push("");
    lines.push(`⚠️ Низких оценок за период: ${acc.lowCount} — нужно подтянуть качество.`);
  } else if (acc && acc.count > 0) {
    lines.push("");
    lines.push("✅ Критичных чатов нет — спасибо за работу!");
  }

  return lines.join("\n");
}

/**
 * Distinct accountants who have something worth sending (a critical chat or a
 * low average) for the period — the people Margarita should message, most
 * urgent first.
 */
export function accountantsToMessage(report: DailyReport): string[] {
  const score = new Map<string, number>();
  const bump = (name: string | null, by: number) => {
    if (!name) return;
    score.set(name, (score.get(name) ?? 0) + by);
  };
  for (const c of report.criticalChats) bump(c.accountant, 100);
  for (const a of report.perAccountant) if (a.lowCount > 0) bump(a.accountant, a.lowCount);
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

export interface WeeklyReportOptions {
  /**
   * Canonical roster order (the active accountant list) for the full
   * per-person week-over-week listing. Falls back to the scored accountants
   * from `report` when omitted.
   */
  roster?: string[];
}

/** "86.60" — an accountant's average, always shown with 2 decimals. */
function fmtAvg(n: number): string {
  return n.toFixed(2);
}

/**
 * Пятничный отчёт (Armenian) — the weekly summary Margarita sends every
 * Friday: last-vs-this-week service %, who improved/worsened with their
 * averages, the most common recurring problems, the full roster's
 * week-over-week averages, and the star(s) of the week:
 *
 *   1․ Անցած շաբաթվա սերվիսի որակը տոկոսներով - 97%
 *   2․ Այս շաբաթվա սերվիսի որակը տոկոսներով - 98%
 *   Առանցձին թիմակիցների մասով․
 *   3․ Բարելավել է արդյունքները ՝ ... - Անուն 86.60 - 95.00
 *   4․ Վատացրել է արդյունքները ՝ ... - Անուն 97.40 - 95.00
 *   5․ Խնդիրները։ Հիմնական ամենաշատ կրկնվողները ՝ պատճառ1, պատճառ2
 *
 *   Անուն — 99.60 - 99.40
 *   ...
 *
 *   շաբաթվա աստղ՝ Անուն /3x - 100, 1x - 98/, Անուն2 /3x - 100, 2x - 99/
 */
export function buildWeeklyReportMessage(
  report: DailyReport,
  previous: DailyReport | null,
  options: WeeklyReportOptions = {}
): string {
  const { roster } = options;
  const lines: string[] = [];

  const prevPct = previous ? Math.round(previous.serviceQualityPct) : null;
  const curPct = Math.round(report.serviceQualityPct);
  lines.push(`1․ Անցած շաբաթվա սերվիսի որակը տոկոսներով - ${prevPct ?? "—"}%`);
  lines.push(`2․ Այս շաբաթվա սերվիսի որակը տոկոսներով - ${curPct}%`);
  lines.push("Առանցձին թիմակիցների մասով․");

  const prevMap = new Map(
    (previous?.perAccountant ?? []).map((a) => [a.accountant, a.avgScore])
  );
  const scored = report.perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0);
  const delta = (a: AccountantScore) => a.avgScore - (prevMap.get(a.accountant) ?? 0);

  const improved = scored
    .filter((a) => prevMap.has(a.accountant) && a.avgScore > prevMap.get(a.accountant)!)
    .sort((a, b) => delta(b) - delta(a));
  const worsened = scored
    .filter((a) => prevMap.has(a.accountant) && a.avgScore < prevMap.get(a.accountant)!)
    .sort((a, b) => delta(a) - delta(b));
  const fmtMover = (a: AccountantScore) =>
    `${a.accountant} ${fmtAvg(prevMap.get(a.accountant)!)} - ${fmtAvg(a.avgScore)}`;

  lines.push(
    `3․ Բարելավել է արդյունքները ՝ նշելով անցած շաբաթվա միջին արդյունքը և այս շաբաթվա միջին արդյունքը - ${improved
      .map(fmtMover)
      .join(", ")}`
  );
  lines.push(
    `4․ Վատացրել է արդյունքները ՝ նշելով անցած շաբաթվա միջին արդյունքը և այս շաբաթվա միջին արդյունքը - ${worsened
      .map(fmtMover)
      .join(", ")}`
  );

  // ── Top recurring problems ────────────────────────────────────────────────
  const probFreq = new Map<string, number>();
  for (const c of report.criticalChats) {
    for (const r of c.reasons) probFreq.set(r, (probFreq.get(r) ?? 0) + 1);
  }
  const topProblems = [...probFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p]) => p);
  lines.push(`5․ Խնդիրները։ Հիմնական ամենաշատ կրկնվողները ՝ ${topProblems.join(", ")}`);

  // ── Full roster, week-over-week ──────────────────────────────────────────
  lines.push("");
  const names = roster && roster.length > 0 ? roster : scored.map((a) => a.accountant);
  for (const name of names) {
    const cur = scored.find((a) => a.accountant === name);
    if (!cur) continue;
    const prev = prevMap.get(name);
    lines.push(`${name} — ${prev !== undefined ? fmtAvg(prev) : "—"} - ${fmtAvg(cur.avgScore)}`);
  }

  // ── Star(s) of the week — accountants with all daily scores ≥ 98 ────────
  if (report.perDayPerAccountant && report.perDayPerAccountant.length > 0) {
    const accDays = new Map<string, number[]>();
    for (const d of report.perDayPerAccountant) {
      if (d.accountant === "—") continue;
      const scores = accDays.get(d.accountant) ?? [];
      scores.push(d.avgScore);
      accDays.set(d.accountant, scores);
    }
    const stars = [...accDays.entries()]
      .filter(([, scores]) => scores.length >= 3 && scores.every((s) => s >= 98))
      .sort((a, b) => {
        const avgA = a[1].reduce((s, x) => s + x, 0) / a[1].length;
        const avgB = b[1].reduce((s, x) => s + x, 0) / b[1].length;
        return avgB - avgA || a[0].localeCompare(b[0]);
      });

    if (stars.length > 0) {
      const starParts = stars.map(([name, scores]) => {
        const countByScore = new Map<number, number>();
        for (const s of scores) countByScore.set(s, (countByScore.get(s) ?? 0) + 1);
        const desc = [...countByScore.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([s, n]) => `${n}x - ${s}`)
          .join(", ");
        return `${name} /${desc}/`;
      });
      lines.push("");
      lines.push(`շաբաթվա աստղ՝ ${starParts.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export interface MargaritaWorkReportOptions {
  /** ISO date / period label shown in the header (defaults to today). */
  date?: string;
  /**
   * Кол-во АКТИВНЫХ чатов за окно (живой книги) — знаменатель для «Проверено
   * чатов: N из M» и процента «Создано тикетов». Берётся из того же расчёта
   * активности, что дашборд/отчёт (DailyReport.totals.activeChats). Когда не
   * передан — показываем «…» и процент не считаем (нельзя делить на неизвестное).
   */
  activeChats?: number;
  /**
   * ВЕСЬ непогашенный бэклог тикетов без реакции бухгалтера (статус «новое»),
   * НЕ только за отчётный день — для строки-алерта «!!! Тикеты без реакций
   * бухгалтеров». Когда не передан, берётся дневное `report.unprocessedViolations`.
   */
  unprocessedBacklog?: number;
  /**
   * ВЕСЬ непогашенный бэклог апелляций без решения Маргариты (pending), НЕ только
   * за отчётный день — для строки-алерта «!!! Аппеляций без реакции Маргариты».
   * Когда не передан, берётся дневное `report.appealsPending`.
   */
  pendingBacklog?: number;
}

/**
 * «Отчет по работе QA Маргариты» — сводка ежедневной QA-работы Маргариты для
 * Telegram. Рендерится из ТОЙ ЖЕ агрегации (buildViolationWorkflowReport), что
 * и веб /work-report и /dashboard, поэтому цифры всегда совпадают.
 *
 * Форма (по запросу руководителя, июль 2026) — сводка + две группы реакций:
 *
 *   Отчет по работе QA Маргариты 20.07.2026
 *
 *   Проверено чатов: 12 из 40
 *   Создано тикетов: 5 (13%)
 *
 *   Аппеляции бухгалтеров
 *   !!! Тикеты без реакций бухгалтеров: 1
 *   Всего реакций: 5
 *   — Ознакомлений: 2
 *   — Апелляций: 3
 *
 *   Реакция Маргариты на аппеляции:
 *   !!! Аппеляций без реакции Маргариты: 1
 *   Всего реакций: 2
 *   — Подтверждено: 1
 *   — Отклонено: 1
 *
 * Смысл строк:
 *   • Проверено чатов — сколько чатов Маргарита проверила ЗА ДЕНЬ, из активных.
 *   • Создано тикетов — сколько нарушений (тикетов) заведено ЗА ДЕНЬ; процент —
 *     от активных чатов.
 *   • Всего реакций (за день) — в каждой группе это активность за отчётный день
 *     (ознакомления + апелляции у бухгалтеров; подтверждено + отклонено у неё).
 *   • Строки «!!!» — это АЛЕРТЫ по всей непогашенной очереди (не только за день):
 *     «Тикеты без реакций бухгалтеров» — все тикеты Маргариты в статусе «новое»,
 *     на которые бухгалтер ещё не отреагировал; «Аппеляций без реакции Маргариты»
 *     — все апелляции, по которым она ещё не приняла решение. Значения бэклога
 *     приходят опциями `unprocessedBacklog`/`pendingBacklog`; без них подставляются
 *     дневные значения из отчёта.
 *
 * Sent as PLAIN text (sendToTelegram uses no parse_mode), so no Markdown/HTML
 * escaping is required and arbitrary characters can never break the layout. If
 * a future caller switches to a parse mode, escape user text first.
 *
 * IMPORTANT (Phase 6): callers MUST catch data-loading failures and NOT call
 * this with an all-zero report — a load failure must read differently from a
 * genuinely quiet day. This function assumes it is given real stored numbers;
 * a quiet day simply shows zeros in the same form.
 */
export function buildMargaritaWorkReportMessage(
  report: ViolationWorkflowReport,
  options: MargaritaWorkReportOptions = {}
): string {
  const dateISO = options.date ?? new Date().toISOString().slice(0, 10);
  const { activeChats } = options;
  const activeLabel =
    typeof activeChats === "number" ? String(activeChats) : "…";
  // Процент созданных тикетов от активных чатов — только когда активные чаты
  // известны и их > 0 (иначе деление на неизвестное/ноль бессмысленно).
  const ticketPct =
    typeof activeChats === "number" && activeChats > 0
      ? Math.round((report.violationsCreated / activeChats) * 100)
      : 0;

  // Реакции бухгалтеров на тикеты Маргариты = ознакомления + поданные апелляции.
  const accountantReactions = report.acknowledged + report.appealsSubmitted;
  // Реакции Маргариты на апелляции = подтверждено + отклонено.
  const margaritaReactions = report.appealsApproved + report.appealsRejected;

  // Строки-алерты «!!!» — ВЕСЬ непогашенный бэклог (не только за день), если он
  // передан; иначе дневные значения из отчёта. Так «Проверено/Создано/Подано»
  // остаются за день, а «без реакции» показывают реальную очередь на действие.
  const unprocessed = options.unprocessedBacklog ?? report.unprocessedViolations;
  const pending = options.pendingBacklog ?? report.appealsPending;

  const lines: string[] = [];
  lines.push(`Отчет по работе QA Маргариты ${fmtFullDay(dateISO)}`);
  lines.push("");
  lines.push(`Проверено чатов: ${report.chatsChecked} из ${activeLabel}`);
  lines.push(`Создано тикетов: ${report.violationsCreated} (${ticketPct}%)`);

  lines.push("");
  lines.push("Аппеляции бухгалтеров");
  lines.push(`!!! Тикеты без реакций бухгалтеров: ${unprocessed}`);
  lines.push(`Всего реакций: ${accountantReactions}`);
  lines.push(`— Ознакомлений: ${report.acknowledged}`);
  lines.push(`— Апелляций: ${report.appealsSubmitted}`);

  lines.push("");
  lines.push("Реакция Маргариты на аппеляции:");
  lines.push(`!!! Аппеляций без реакции Маргариты: ${pending}`);
  lines.push(`Всего реакций: ${margaritaReactions}`);
  lines.push(`— Подтверждено: ${report.appealsApproved}`);
  lines.push(`— Отклонено: ${report.appealsRejected}`);

  return lines.join("\n");
}

/**
 * Escape text for a Telegram message sent with HTML parse mode. Unused by the
 * current plain-text sender, but provided so any future parse-mode caller can
 * render user-controlled names/notes safely.
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Per-chat / per-accountant score message. */
export function buildScoreMessage(
  evaluation: Evaluation,
  chat: Chat | null
): string {
  const lines: string[] = [];
  const name = chat?.chat_name ?? evaluation.chat_agr_no;
  lines.push(`📝 Оценка чата: ${name} (№ ${evaluation.chat_agr_no})`);
  lines.push(`Дата проверки: ${evaluation.checking_date}`);
  lines.push(`Общая оценка: ${evaluation.total_score}% — ${evaluation.quality_band}`);
  if (evaluation.accountant) lines.push(`Ответственный: ${evaluation.accountant}`);

  const fails = failingMailings(evaluation.scores.monthly);
  if (fails.length) {
    lines.push(
      `⚠ Не выполнена рассылка: ${fails.map((f) => `${f.category} (${f.status})`).join(", ")}`
    );
  }

  const monthly = evaluation.scores.monthly;
  if (monthly) {
    const parts = MONTHLY_CATEGORIES.filter((c) => monthly[c.id]?.status).map(
      (c) => `${c.shortName}: ${monthly[c.id].status}`
    );
    if (parts.length) {
      lines.push("");
      lines.push(parts.join(" | "));
    }
  }

  if (evaluation.comment) {
    lines.push("");
    lines.push(`Комментарий: ${evaluation.comment}`);
  }
  if (chat?.chat_link) {
    lines.push("");
    lines.push(`Чат: ${chat.chat_link}`);
  }
  return lines.join("\n");
}

// --- Client survey invitation (from the "Чаты" AM / RU columns) ------------

const SURVEY_BASE = "https://onebusiness.typeform.com/to/otGeEHGj#client_id=";

export function surveyInviteRu(chat: Chat): string {
  return [
    "Для нашей команды очень важно поддерживать обратную связь с вами.",
    "",
    "Пожалуйста, уделите опросу всего 5 минут вашего времени",
    `${SURVEY_BASE}${chat.agr_no}`,
  ].join("\n");
}

export function surveyInviteAm(chat: Chat): string {
  return [
    "Թիմի համար շատ կարևոր է պահպանել հետադարձ կապը ձեզ հետ, խնդրում ենք հատկացնել հարցմանը ընդամենը 5 րոպե ձեր ժամանակից։",
    `${SURVEY_BASE}${chat.agr_no}`,
  ].join("\n");
}
