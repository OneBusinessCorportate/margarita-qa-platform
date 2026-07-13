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
 * Daily accounting report message — matches the format the department sends,
 * with each accountant's violations merged directly UNDER their request count:
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
 *   Кол-во запросов за день:
 *
 *   Գայանե — 3
 *   Нарушения:
 *   - B-1234 — поздний ответ — предупреждение / 0 др
 *   - B-5678 — без ответа — 1 000 др
 *
 *   Դավիթ — 10
 *   Нарушения: нет
 *
 * Only accountants with requests OR violations are listed (roster order); the
 * separate all-employees violations report is no longer sent. Money is the
 * simple daily rule — 1st violation per accountant/day = предупреждение (0 др),
 * every next = 1 000 др (hard cap 1 000; severity/AI never sets the amount).
 * Violations passed in must already be Margarita's confirmed rows.
 */
export function buildReportMessage(
  report: DailyReport,
  options: ReportMessageOptions = {}
): string {
  const { serviceQualityPct, perAccountant, filters } = report;
  const { violations = [], sheetUrl, roster, requests, requestDays } = options;
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

  // ── Кол-во запросов за день + нарушения ПОД КАЖДЫМ бухгалтером ──────────────
  // Единый блок: для каждого бухгалтера — число запросов за день, а сразу под
  // ним его нарушения (или «Нарушения: нет»). Отдельный длинный отчёт по всем
  // сотрудникам больше не нужен.
  //
  // Деньги — простое правило Маргариты, БЕЗ ИИ-тяжести и без ручных санкций:
  //   • 1-е нарушение бухгалтера за ДЕНЬ → предупреждение / 0 др;
  //   • 2-е и каждое следующее за тот же день → 1 000 др.
  // Максимум — 1 000 др, суммы 2 000 и выше НЕ используются. Нарушения берём как
  // есть от вызывающей стороны (только подтверждённые Маргаритой).
  const DAILY_PENALTY = 1000; // потолок штрафа за одно нарушение
  type ViolItem = { code: string; type: string; fine: number };
  const violByAcc = new Map<string, ViolItem[]>();
  const seenAccDay = new Map<string, number>();
  let totalFine = 0;
  // Стабильный порядок: по дню, затем по времени создания — так «первое» за день
  // определяется детерминированно.
  const sortedViol = [...violations].sort(
    (a, b) =>
      (a.vdate ?? "").localeCompare(b.vdate ?? "") ||
      (a.created_at ?? "").localeCompare(b.created_at ?? "")
  );
  for (const v of sortedViol) {
    const acc = v.accountant?.trim() || "-";
    const day = (v.vdate ?? "").slice(0, 10);
    const seenKey = `${acc}|${day}`;
    const seen = seenAccDay.get(seenKey) ?? 0;
    const fine = seen >= 1 ? DAILY_PENALTY : 0; // 1-е за день — предупреждение
    seenAccDay.set(seenKey, seen + 1);
    totalFine += fine;
    const list = violByAcc.get(acc) ?? [];
    list.push({
      code: v.chat_agr_no?.trim() || "-",
      type: (v.violation_type ?? "").trim() || "-",
      fine,
    });
    violByAcc.set(acc, list);
  }

  // Per-day request figure per accountant.
  const days = requestDays && requestDays > 1 ? requestDays : 1;
  const reqByAcc = new Map<string, number>();
  for (const r of requests ?? []) {
    reqByAcc.set(r.accountant, Math.round(r.count / days));
  }

  // Кого показываем: бухгалтеры с запросами за день ИЛИ с нарушениями. С
  // ростером — в порядке ростера, плюс нарушители вне ростера (напр. «-»).
  const namesToShow: string[] = [];
  const seenName = new Set<string>();
  const addName = (name: string) => {
    if (seenName.has(name)) return;
    seenName.add(name);
    namesToShow.push(name);
  };
  if (rosterSet) {
    for (const n of roster!) if ((reqByAcc.get(n) ?? 0) > 0 || violByAcc.has(n)) addName(n);
    for (const acc of violByAcc.keys()) if (!rosterSet.has(acc)) addName(acc);
  } else {
    for (const r of requests ?? []) if (r.count > 0) addName(r.accountant);
    for (const acc of violByAcc.keys()) addName(acc);
  }

  if (namesToShow.length > 0) {
    lines.push("");
    lines.push("Кол-во запросов за день:");
    for (const name of namesToShow) {
      const count = reqByAcc.get(name) ?? 0;
      const viols = violByAcc.get(name) ?? [];
      lines.push("");
      lines.push(`${name} — ${count}`);
      if (viols.length === 0) {
        lines.push("Нарушения: нет");
      } else {
        lines.push("Нарушения:");
        for (const item of viols) {
          const money =
            item.fine > 0 ? `${fmtDram(item.fine)} др` : "предупреждение / 0 др";
          lines.push(`- ${item.code} — ${item.type} — ${money}`);
        }
      }
    }
    if (totalFine > 0) {
      lines.push("");
      lines.push(`Итого штрафов: ${fmtDram(totalFine)} др`);
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

/** Одна строка сверки чата налогового кабинета с dashboard. */
export interface TaxCabinetRow {
  agr_no: string;
  client: string | null; // клиент / компания
  hvhh: string | null;
  accountant: string | null; // ответственный бухгалтер
  manager: string | null;
  inTaxCabinet: boolean; // есть ли в налоговом кабинете
  inDashboard: boolean; // есть ли в dashboard
  /** Короткое описание расхождения; null — расхождения нет. */
  discrepancy: string | null;
}

export interface TaxCabinetReconInput {
  /** Всего чатов, у которых есть данные налогового кабинета. */
  taxTotal: number;
  /** Сколько из них присутствуют (активны) в dashboard. */
  inDashboard: number;
  /** Детальные строки для вывода (обычно только расхождения). */
  rows: TaxCabinetRow[];
  date?: string;
}

/**
 * Сверка налогового кабинета с dashboard: сводка (сколько чатов в кабинете,
 * сколько в dashboard, сколько расхождений) плюс детальный разбор по каждой
 * строке-расхождению. По каждому чату видно: клиент/компания, HVHH, чат,
 * ответственный бухгалтер, менеджер, есть ли он в налоговом кабинете, есть ли в
 * dashboard и в чём расхождение. Данные реальные (mqa_chats + mqa_violations),
 * ничего не выдумывается.
 */
export function buildTaxCabinetReconciliation(input: TaxCabinetReconInput): string {
  const { taxTotal, inDashboard, rows } = input;
  const dateISO = input.date ?? new Date().toISOString().slice(0, 10);
  const discrepancies = rows.filter((r) => r.discrepancy);

  const lines: string[] = [];
  lines.push("Сверка налогового кабинета");
  lines.push("");
  lines.push(`Дата: ${fmtFullDay(dateISO)}`);
  lines.push("");
  lines.push(`Чатов в налоговом кабинете: ${taxTotal}`);
  lines.push(`Из них в dashboard: ${inDashboard}`);
  lines.push(`Расхождений: ${discrepancies.length}`);

  if (rows.length === 0) {
    lines.push("");
    lines.push("Все чаты налогового кабинета есть в dashboard — расхождений нет ✅");
    return lines.join("\n");
  }

  const yn = (b: boolean) => (b ? "да" : "нет");
  for (const r of rows) {
    lines.push("");
    lines.push(`▸ ${r.client?.trim() || r.agr_no} — ${r.agr_no}`);
    lines.push(`  HVHH: ${r.hvhh?.trim() || "не указан"}`);
    lines.push(`  Бухгалтер: ${r.accountant?.trim() || "не указан"}`);
    lines.push(`  Менеджер: ${r.manager?.trim() || "не указан"}`);
    lines.push(`  В налоговом кабинете: ${yn(r.inTaxCabinet)}`);
    lines.push(`  В dashboard: ${yn(r.inDashboard)}`);
    lines.push(`  Расхождение: ${r.discrepancy ?? "нет"}`);
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
