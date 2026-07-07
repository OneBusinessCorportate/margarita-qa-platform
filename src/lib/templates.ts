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
import { computeViolationFines } from "./violations";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** DD.MM from an ISO date (for the report header). */
function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
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
  /**
   * Computed fine (драм) per violation id — the daily report uses
   * computeIndividualFines (each case priced on its own: Среднее → 1 000,
   * Критичное → 2 000, Грубое → per-year escalation; a manual sanction wins
   * inside the computation). When provided, EVERY violation line shows its
   * money: the amount, or «предупреждение» when the rules say 0. Without it
   * the line falls back to the manually entered sanction only (legacy).
   */
  fineById?: Record<string, number>;
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
 * Daily accounting report message — matches the format the department sends:
 *
 *   Ежедневный отчет бухгалтерии
 *
 *   Дата: 15.05
 *
 *   Общий уровень сервиса: 84% по отделу
 *
 *   Звезда дня
 *
 *   ⭐️ Имя: 100% оценка
 *
 *   Нарушения:
 *
 *   — Имя: Выговор
 *     ▸ B-4742 — причина — 1 000 др
 *
 *   Кол-во запросов за день:
 *
 *   Имя — 8
 *
 * People sections are limited to the canonical roster (options.roster). The
 * violations block lists every accountant who has a violation in the window
 * (including unassigned rows, shown as "-"), each with one bullet per
 * violation record: the chat code, the reason, and the fine (if any) —
 * no chat/client name.
 */
export function buildReportMessage(
  report: DailyReport,
  options: ReportMessageOptions = {}
): string {
  const { serviceQualityPct, perAccountant, filters } = report;
  const { violations = [], sheetUrl, roster, requests, requestDays, fineById } = options;
  const dateISO =
    options.date ??
    filters.to ??
    filters.from ??
    new Date().toISOString().slice(0, 10);
  const rosterSet = roster && roster.length > 0 ? new Set(roster) : null;
  const inRoster = (name: string) => !rosterSet || rosterSet.has(name);
  const lines: string[] = [];

  lines.push("Ежедневный отчет бухгалтерии");
  lines.push("");
  lines.push(`Дата: ${periodHeader(report, dateISO)}`);
  lines.push("");
  lines.push(`Общий уровень сервиса: ${serviceQualityPct}% по отделу`);

  // ── Stars of the day (roster only) ─────────────────────────────────────────
  const scored = perAccountant.filter(
    (a) => a.count > 0 && a.avgScore >= 0 && inRoster(a.accountant)
  );
  const topScore = scored.reduce((m, a) => Math.max(m, a.avgScore), 0);
  const perfect = scored.filter((a) => a.avgScore === 100);
  const stars = perfect.length
    ? perfect
    : topScore > 0
      ? scored.filter((a) => a.avgScore === topScore)
      : [];

  if (stars.length) {
    lines.push("");
    lines.push("Звезда дня");
    lines.push("");
    for (const s of stars) {
      lines.push(`⭐️ ${s.accountant}: ${s.avgScore}% оценка`);
    }
  }

  // ── Violations — per-person breakdown, one bullet per violation record ─────
  // «— Имя: Действие · штраф N др» then «  ▸ код — причина — сумма» for every
  // violation of that person (rows with no accountant are grouped under "-").
  // No chat/client name — just the chat code and the money. With `fineById`
  // the money comes from the «Условия» pricing rules for EVERY line (0 др →
  // «предупреждение»); otherwise only a manually entered sanction shows.
  if (violations.length) {
    const byAcc = new Map<
      string,
      {
        sevMap: Map<string, number>;
        fine: number;
        items: { code: string; reason: string; money: string }[];
      }
    >();
    let totalFine = 0;
    for (const v of violations) {
      const acc = v.accountant?.trim() || "-";
      const sev = v.severity ?? "среднее";
      const entry =
        byAcc.get(acc) ??
        { sevMap: new Map<string, number>(), fine: 0, items: [] };
      entry.sevMap.set(sev, (entry.sevMap.get(sev) ?? 0) + 1);
      const code = v.chat_agr_no?.trim() || "-";
      const reason = (v.violation_type ?? "").trim() || "-";
      const computed = fineById?.[v.id];
      const fine =
        typeof computed === "number"
          ? computed
          : typeof v.sanction === "number" && v.sanction > 0
            ? v.sanction
            : null;
      const money =
        fine === null
          ? ""
          : fine > 0
            ? ` — ${fmtDram(fine)} др`
            : " — предупреждение";
      if (fine !== null && fine > 0) {
        entry.fine += fine;
        totalFine += fine;
      }
      entry.items.push({ code, reason, money });
      byAcc.set(acc, entry);
    }
    lines.push("");
    lines.push("Нарушения:");
    for (const [acc, { sevMap, fine, items }] of byAcc) {
      lines.push("");
      const fineSuffix = fine > 0 ? ` · штраф ${fmtDram(fine)} др` : "";
      lines.push(`— ${acc}: ${worstViolationAction(sevMap)}${fineSuffix}`);
      for (const item of items) {
        lines.push(`  ▸ ${item.code} — ${item.reason}${item.money}`);
      }
    }
    if (totalFine > 0) {
      lines.push("");
      lines.push(`Итого штрафов: ${fmtDram(totalFine)} др`);
    }
  }

  // ── Client requests per day (roster only, roster order) ────────────────────
  const reqRows = (requests ?? []).filter((r) => r.count > 0 && inRoster(r.accountant));
  if (reqRows.length > 0) {
    if (rosterSet) {
      const order = new Map(roster!.map((n, i) => [n, i]));
      reqRows.sort((a, b) => (order.get(a.accountant) ?? 99) - (order.get(b.accountant) ?? 99));
    }
    const days = requestDays && requestDays > 1 ? requestDays : 1;
    lines.push("");
    lines.push("Кол-во запросов за день:");
    lines.push("");
    for (const r of reqRows) {
      lines.push(`${r.accountant} — ${Math.round(r.count / days)}`);
    }
  }

  if (sheetUrl) {
    lines.push("");
    lines.push(`🔗 ${sheetUrl}`);
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
  // Money per violation from the «Условия» rules (manual sanction still wins).
  const fines = computeViolationFines(withAcc, { grossPrior });
  const byAcc = new Map<
    string,
    { sevMap: Map<string, number>; fine: number; count: number; reasons: string[] }
  >();
  for (let i = 0; i < withAcc.length; i++) {
    const v = withAcc[i];
    const acc = v.accountant as string;
    const sev = v.severity ?? "среднее";
    const entry =
      byAcc.get(acc) ??
      { sevMap: new Map<string, number>(), fine: 0, count: 0, reasons: [] };
    entry.sevMap.set(sev, (entry.sevMap.get(sev) ?? 0) + 1);
    entry.count += 1;
    entry.fine += fines[i];
    const reason = (v.violation_type ?? "").trim();
    if (reason && !entry.reasons.includes(reason)) entry.reasons.push(reason);
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
 * (computeViolationFines — a manual sanction on a violation still wins), so
 * the monthly figures always match the «итого за месяц» totals shown there.
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
  const fines = computeViolationFines(withAcc, { grossPrior });
  const byAcc = new Map<
    string,
    { items: { code: string; reason: string; fine: number }[]; total: number }
  >();
  for (let i = 0; i < withAcc.length; i++) {
    const v = withAcc[i];
    const acc = v.accountant as string;
    const entry = byAcc.get(acc) ?? { items: [], total: 0 };
    entry.items.push({
      code: v.chat_agr_no?.trim() || "-",
      reason: (v.violation_type ?? "").trim() || "-",
      fine: fines[i],
    });
    entry.total += fines[i];
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
  const waiting = (report.unansweredChats ?? []).filter(
    (c) => c.accountant === accountant
  );

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

  if (waiting.length) {
    lines.push("");
    lines.push(`⏳ Чаты без ответа (${waiting.length}):`);
    for (const w of waiting.slice(0, 10)) {
      const days =
        w.waitingDays != null && w.waitingDays > 0 ? ` · ждёт ${w.waitingDays} дн` : "";
      lines.push(`• ${chatLabel(w.chat_agr_no, w.chat_name)}${days}`);
    }
  }

  return lines.join("\n");
}

/**
 * Distinct accountants who have something worth sending (a critical chat, a low
 * average, or a chat still waiting on a reply) for the period — the people
 * Margarita should message, most urgent first.
 */
export function accountantsToMessage(report: DailyReport): string[] {
  const score = new Map<string, number>();
  const bump = (name: string | null, by: number) => {
    if (!name) return;
    score.set(name, (score.get(name) ?? 0) + by);
  };
  for (const c of report.criticalChats) bump(c.accountant, 100);
  for (const w of report.unansweredChats ?? []) bump(w.accountant, 10);
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
