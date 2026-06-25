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

import type { DailyReport } from "./report";
import { MONTHLY_CATEGORIES, bandFor, failingMailings, type QualityBand } from "./scoring";
import type { Chat, Evaluation, Violation } from "./types";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function fmtDateRange(from?: string, to?: string): string {
  if (from && to && from === to) return from;
  if (from && to) return `${from} — ${to}`;
  if (from) return `с ${from}`;
  if (to) return `по ${to}`;
  return "за всё время";
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
  /** Violations for the period — grouped per accountant in the message. */
  violations?: Violation[];
  /** Optional Google-Sheet (or any) link appended at the end. */
  sheetUrl?: string;
  /** ISO date shown in the header; defaults to the filter's `to`, else today. */
  date?: string;
  /**
   * The preceding comparable period, for the ▲/▼ trend on the service line.
   * Supplied by getDailyAnalytics; omit to skip the trend.
   */
  previous?: DailyReport | null;
  /**
   * The current week's report (Mon–today), used to compute weekly star counts.
   * When provided, each star-of-day entry shows "Звезда N из 5 на этой неделе".
   */
  weeklyReport?: DailyReport | null;
  /** Cap on how many rows each detail list prints before "+ ещё N". */
  maxList?: number;
}

/**
 * Compute how many times each accountant was "star of the day" in a weekly
 * report. A star is awarded to whoever scored highest on a given day
 * (100% takes priority; if nobody hit 100%, the day's top scorer wins).
 * Returns a map of accountant name → star count.
 */
function computeWeeklyStarCounts(weekReport: DailyReport): Map<string, number> {
  const counts = new Map<string, number>();
  const source = weekReport.perDayPerAccountant;
  if (!source || source.length === 0) return counts;

  const byDate = new Map<string, { accountant: string; avgScore: number }[]>();
  for (const d of source) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date)!.push(d);
  }

  for (const dayScores of byDate.values()) {
    const valid = dayScores.filter((d) => d.avgScore > 0);
    if (valid.length === 0) continue;
    const perfect = valid.filter((d) => d.avgScore === 100);
    const topScore = valid.reduce((m, d) => Math.max(m, d.avgScore), 0);
    const dayStars = perfect.length > 0 ? perfect : valid.filter((d) => d.avgScore === topScore);
    for (const s of dayStars) {
      counts.set(s.accountant, (counts.get(s.accountant) ?? 0) + 1);
    }
  }
  return counts;
}

/** Number of unique evaluation days in a report (used as the "out of N" denominator). */
function evalDayCount(report: DailyReport): number {
  const source = report.perDayPerAccountant;
  if (!source) return 1; // single-day window
  return new Set(source.map((d) => d.date)).size;
}

/**
 * "🟢▲ +0.6 п.п. к 10.06 — SLA улучшился" / "🔴▼ −1.2 п.п. — ухудшение SLA" vs the previous period.
 * Accepts the full current report to compute criteria-based reason.
 */
function fmtTrend(cur: DailyReport, prev: DailyReport | null | undefined): string {
  if (!prev) return "";
  const curPct = cur.serviceQualityPct;
  const prevPct = prev.serviceQualityPct;
  const d = Math.round((curPct - prevPct) * 10) / 10;
  const label = fmtDay(prev.filters.to ?? prev.filters.from ?? "");
  const to = label ? ` к ${label}` : "";

  let reason = "";
  if (cur.criteriaAvg && prev.criteriaAvg) {
    const slaDiff = Math.round((cur.criteriaAvg.sla - prev.criteriaAvg.sla) * 100) / 100;
    const accDiff = Math.round((cur.criteriaAvg.accuracy - prev.criteriaAvg.accuracy) * 100) / 100;
    const parts: string[] = [];
    if (Math.abs(slaDiff) >= 0.05) {
      parts.push(`SLA ${slaDiff > 0 ? "улучшился" : "ухудшился"} (${slaDiff > 0 ? "+" : ""}${slaDiff.toFixed(2)})`);
    }
    if (Math.abs(accDiff) >= 0.05) {
      parts.push(`Точность ${accDiff > 0 ? "улучшилась" : "ухудшилась"} (${accDiff > 0 ? "+" : ""}${accDiff.toFixed(2)})`);
    }
    reason = parts.join(", ");
  }
  if (!reason) {
    const critDiff = cur.distribution["Критично"] - prev.distribution["Критично"];
    if (critDiff > 0) reason = `критичных оценок больше на ${critDiff}`;
    else if (critDiff < 0) reason = `критичных оценок меньше на ${Math.abs(critDiff)}`;
  }

  const reasonSuffix = reason ? ` — ${reason}` : "";
  if (d > 0) return `  🟢▲ +${d} п.п.${to}${reasonSuffix}`;
  if (d < 0) return `  🔴▼ ${d} п.п.${to}${reasonSuffix}`;
  return `  → без изменений${to}`;
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

/**
 * Daily accounting analytics message.
 *
 * Format:
 *   📊 Аналитика качества бухгалтерии
 *   🗓 DD.MM
 *
 *   🏆 Сервис Бухгалтерии: X%  ▲ +N п.п. к DD.MM
 *   👁 Охват: оценено N из M активных (K%)
 *
 *   Звезда дня
 *
 *
 *   ⭐️ Имя: X% оценка
 *   ...
 *
 *
 *   Нарушения:
 *
 *   — Имя: ActionType (N severity)
 *   ...
 */
export function buildReportMessage(
  report: DailyReport,
  options: ReportMessageOptions = {}
): string {
  const { totals, serviceQualityPct, coveragePct, perAccountant, filters } = report;
  const { violations = [], sheetUrl, previous, weeklyReport } = options;
  const dateISO =
    options.date ??
    filters.to ??
    filters.from ??
    new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push("📊 Аналитика качества бухгалтерии");
  lines.push(`🗓 ${periodHeader(report, dateISO)}`);
  lines.push("");
  lines.push(`🏆 Сервис Бухгалтерии: ${serviceQualityPct}%${fmtTrend(report, previous)}`);
  lines.push(
    `👁 Охват: оценено ${totals.evaluatedChats} из ${totals.activeChats} активных (${coveragePct}%)`
  );

  // ── Stars of the day ───────────────────────────────────────────────────────
  const scored = perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0);
  const topScore = scored.reduce((m, a) => Math.max(m, a.avgScore), 0);
  const perfect = scored.filter((a) => a.avgScore === 100);
  const stars = perfect.length
    ? perfect
    : topScore > 0
      ? scored.filter((a) => a.avgScore === topScore)
      : [];

  // Weekly star counts: how many days each accountant was star this week (out of 5 max).
  const weeklyStarCounts = weeklyReport ? computeWeeklyStarCounts(weeklyReport) : new Map<string, number>();
  const weekDays = weeklyReport ? 5 : 0;

  if (stars.length) {
    lines.push("");
    lines.push("Звезда дня");
    lines.push("");
    lines.push("");
    for (let i = 0; i < stars.length; i++) {
      const name = stars[i].accountant;
      const weekCount = weeklyStarCounts.get(name) ?? 1;
      const weekSuffix = weekDays > 0 ? ` Звезда ${weekCount} из ${weekDays} на этой неделе` : "";
      lines.push(`⭐️ ${name}: ${stars[i].avgScore}% оценка${weekSuffix}`);
      if (i < stars.length - 1) lines.push("");
    }
  }

  // ── All accountant results ─────────────────────────────────────────────────
  if (scored.length > 0) {
    const sorted = [...scored].sort((a, b) => b.avgScore - a.avgScore);
    lines.push("");
    lines.push("👥 Результаты по бухгалтерам:");
    lines.push("");
    for (const a of sorted) {
      const emoji = BAND_EMOJI[bandFor(a.avgScore)];
      lines.push(`${emoji} ${a.accountant}: ${a.avgScore}% (${a.count} чатов)`);
    }
  }

  // ── Manager results ────────────────────────────────────────────────────────
  const mScored = (report.managerScores ?? []).filter((a) => a.count > 0 && a.avgScore >= 0);
  if (mScored.length > 0) {
    lines.push("");
    lines.push("👔 Результаты менеджеров:");
    lines.push("");
    for (const a of [...mScored].sort((a, b) => b.avgScore - a.avgScore)) {
      const emoji = BAND_EMOJI[bandFor(a.avgScore)];
      lines.push(`${emoji} ${a.accountant}: ${a.avgScore}% (${a.count} чатов)`);
    }
  }

  // ── Critical chats from evaluations ───────────────────────────────────────
  const critChats = report.criticalChats ?? [];
  if (critChats.length > 0) {
    lines.push("");
    lines.push(`⛔️ Критичные чаты (${critChats.length}):`);
    lines.push("");
    for (const c of critChats) {
      const who = c.accountant ? ` (${c.accountant})` : "";
      const why = c.reasons.length ? ` — ${c.reasons.join("; ")}` : ` (оценка ${c.score}%)`;
      lines.push(`• ${chatLabel(c.chat_agr_no, c.chat_name)}${who}${why}`);
    }
  }

  // ── Violations ─────────────────────────────────────────────────────────────
  const withAcc = violations.filter((v) => v.accountant);
  if (withAcc.length) {
    // Group by accountant, preserving individual violation details.
    const byAcc = new Map<
      string,
      { sevMap: Map<string, number>; items: Array<{ label: string; reason: string }> }
    >();
    for (const v of withAcc) {
      const acc = v.accountant as string;
      const sev = v.severity ?? "среднее";
      const entry = byAcc.get(acc) ?? { sevMap: new Map<string, number>(), items: [] };
      entry.sevMap.set(sev, (entry.sevMap.get(sev) ?? 0) + 1);
      // Per-violation detail: chat label + reason (violation_type, then note).
      const label = v.chat_agr_no ? chatLabel(v.chat_agr_no, v.client) : (v.client ?? "");
      const reason = [v.violation_type, v.note].filter(Boolean).join(" — ");
      entry.items.push({ label, reason });
      byAcc.set(acc, entry);
    }
    lines.push("");
    lines.push("");
    lines.push("Нарушения:");
    lines.push("");
    const entries = [...byAcc.entries()];
    for (let i = 0; i < entries.length; i++) {
      const [acc, { sevMap, items }] = entries[i];
      const action = worstViolationAction(sevMap);
      lines.push(`— ${acc}: ${action} — требует действия бухгалтера`);
      for (const { label, reason } of items) {
        const why = reason ? ` — ${reason}` : "";
        if (label) lines.push(`  ▸ ${label}${why}`);
        else if (reason) lines.push(`  ▸ ${reason}`);
      }
      if (i < entries.length - 1) lines.push("");
    }
  }

  if (sheetUrl) {
    lines.push("");
    lines.push(`🔗 ${sheetUrl}`);
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

/** "16–22 июн 2026" from Mon ISO date. */
function weekLabelFromISO(from: string, to: string): string {
  const MONTHS = [
    "янв","фев","мар","апр","май","июн",
    "июл","авг","сен","окт","ноя","дек",
  ];
  const f = new Date(from + "T00:00:00Z");
  const t = new Date(to + "T00:00:00Z");
  const m1 = MONTHS[f.getUTCMonth()];
  const m2 = MONTHS[t.getUTCMonth()];
  if (f.getUTCMonth() === t.getUTCMonth() && f.getUTCFullYear() === t.getUTCFullYear()) {
    return `${f.getUTCDate()}–${t.getUTCDate()} ${m1} ${f.getUTCFullYear()}`;
  }
  return `${f.getUTCDate()} ${m1}–${t.getUTCDate()} ${m2} ${f.getUTCFullYear()}`;
}

export interface WeeklyReportOptions {
  /** Override the week label shown in the header. */
  weekLabel?: string;
}

/**
 * Weekly summary message for Emilia — the one Margarita sends each Monday.
 * Shows last-vs-this-week service %, who improved/worsened, stars of the week,
 * and top recurring problems. Designed to match the Google Sheets format she
 * used to fill manually.
 */
export function buildWeeklyReportMessage(
  report: DailyReport,
  previous: DailyReport | null,
  options: WeeklyReportOptions = {}
): string {
  const { from, to } = report.filters;
  const label =
    options.weekLabel ??
    (from && to ? weekLabelFromISO(from, to) : fmtDateRange(from, to));
  const lines: string[] = [];

  lines.push(`📊 Еженедельный отчёт | ${label}`);
  lines.push("");

  // ── Service quality comparison ───────────────────────────────────────────
  if (previous) {
    const prevPct = previous.serviceQualityPct;
    const curPct = report.serviceQualityPct;
    const delta = Math.round((curPct - prevPct) * 10) / 10;
    const arrow = delta > 0 ? `🟢▲ +${delta} п.п.` : delta < 0 ? `🔴▼ ${delta} п.п.` : "→ без изменений";
    lines.push(`📈 Качество сервиса:`);
    lines.push(`  Прошлая неделя: ${prevPct}%`);
    lines.push(`  Эта неделя: ${curPct}%  ${arrow}`);
  } else {
    lines.push(`📈 Качество сервиса: ${report.serviceQualityPct}%`);
  }

  // ── Per-accountant trend ─────────────────────────────────────────────────
  if (previous) {
    const prevMap = new Map(previous.perAccountant.map((a) => [a.accountant, a.avgScore]));
    const scored = report.perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0);

    const improved = scored
      .filter((a) => {
        const p = prevMap.get(a.accountant);
        return p !== undefined && a.avgScore > p;
      })
      .sort((a, b) => {
        const da = a.avgScore - (prevMap.get(a.accountant) ?? 0);
        const db = b.avgScore - (prevMap.get(b.accountant) ?? 0);
        return db - da;
      });

    const worsened = scored
      .filter((a) => {
        const p = prevMap.get(a.accountant);
        return p !== undefined && a.avgScore < p;
      })
      .sort((a, b) => {
        const da = a.avgScore - (prevMap.get(a.accountant) ?? 0);
        const db = b.avgScore - (prevMap.get(b.accountant) ?? 0);
        return da - db;
      });

    if (improved.length) {
      lines.push("");
      lines.push("✅ Улучшили показатели:");
      for (const a of improved) {
        const p = prevMap.get(a.accountant)!;
        lines.push(`• ${a.accountant}: ${p}% → ${a.avgScore}%`);
      }
    }

    if (worsened.length) {
      lines.push("");
      lines.push("⚠️ Ухудшили показатели:");
      for (const a of worsened) {
        const p = prevMap.get(a.accountant)!;
        lines.push(`• ${a.accountant}: ${p}% → ${a.avgScore}%`);
      }
    }

    // ── Full roster ────────────────────────────────────────────────────────
    lines.push("");
    lines.push("👥 Результаты по бухгалтерам:");
    const roster = [...report.perAccountant.filter((a) => a.count > 0 && a.avgScore >= 0)]
      .sort((a, b) => b.avgScore - a.avgScore);
    for (const a of roster) {
      const emoji = BAND_EMOJI[bandFor(a.avgScore)];
      const prev = prevMap.get(a.accountant);
      const prevStr = prev !== undefined ? `${prev}% → ` : "";
      lines.push(`${emoji} ${a.accountant}: ${prevStr}${a.avgScore}%`);
    }
  } else {
    lines.push("");
    lines.push("👥 Результаты по бухгалтерам:");
    for (const a of [...report.perAccountant].sort((x, y) => y.avgScore - x.avgScore)) {
      if (a.count === 0 || a.avgScore < 0) continue;
      const emoji = BAND_EMOJI[bandFor(a.avgScore)];
      lines.push(`${emoji} ${a.accountant}: ${a.avgScore}%`);
    }
  }

  // ── Stars of the week — accountants with all daily scores ≥ 98 ──────────
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
      lines.push("");
      lines.push("⭐ Звёзды недели:");
      for (const [name, scores] of stars) {
        const countByScore = new Map<number, number>();
        for (const s of scores) countByScore.set(s, (countByScore.get(s) ?? 0) + 1);
        const desc = [...countByScore.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([s, n]) => `${n}×${s}`)
          .join(", ");
        lines.push(`🌟 ${name} (${desc})`);
      }
    }
  }

  // ── Top recurring problems ────────────────────────────────────────────────
  const probFreq = new Map<string, number>();
  for (const c of report.criticalChats) {
    for (const r of c.reasons) {
      probFreq.set(r, (probFreq.get(r) ?? 0) + 1);
    }
  }
  if (probFreq.size > 0) {
    lines.push("");
    lines.push("❗ Основные проблемы:");
    const sorted = [...probFreq.entries()].sort((a, b) => b[1] - a[1]);
    for (const [prob, cnt] of sorted.slice(0, 5)) {
      lines.push(`• ${prob}${cnt > 1 ? ` (×${cnt})` : ""}`);
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
