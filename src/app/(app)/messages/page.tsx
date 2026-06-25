import { getDailyAnalytics, getReport, listAccountants, listViolations } from "@/lib/repo";
import { mondayOf } from "@/lib/scoring";
import type { DaySummary } from "@/lib/report";
import { addDays } from "@/lib/report";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildReportMessage,
  buildWeeklyReportMessage,
  telegramConfigured,
} from "@/lib/templates";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";
import PrintComparisonButton from "@/components/PrintComparisonButton";

export const dynamic = "force-dynamic";

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

/** True for any multi-day period that starts on Monday (full week or partial). */
function isWeekFromMonday(from?: string, to?: string): boolean {
  if (!from || !to || from === to) return false;
  try {
    const f = new Date(from + "T00:00:00Z");
    return f.getUTCDay() === 1;
  } catch { return false; }
}

function rangeDates(from: string, to: string): string[] {
  const result: string[] = [];
  const end = new Date(to + "T00:00:00Z");
  const cur = new Date(from + "T00:00:00Z");
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

function fmtShortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}`;
}

function scoreCellClass(score: number | undefined): string {
  if (score === undefined || score < 0) return "bg-white text-gray-300";
  if (score >= 98) return "bg-green-100 text-green-800 font-semibold";
  if (score >= 90) return "bg-white text-gray-700";
  if (score >= 80) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-700";
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    accountant?: string;
    client?: string;
  };
}) {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonday = mondayOf(today);
  const filters = {
    from: searchParams.from || thisMonday,
    to: searchParams.to || today,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  const [{ report, previous, resolved }, allAccountants] = await Promise.all([
    getDailyAnalytics(filters),
    listAccountants(),
  ]);

  const violations = await listViolations({
    from: resolved.from,
    to: resolved.to,
    accountant: filters.accountant,
  });

  // Weekly report for star counts (Mon → resolved.to).
  const mondayISO = mondayOf(resolved.to);
  const isAlreadyWeekStart = resolved.from === mondayISO;
  const weeklyReport = isAlreadyWeekStart && resolved.from !== resolved.to
    ? report
    : await getReport({ from: mondayISO, to: resolved.to, accountant: filters.accountant });

  const canonicalAccountants = allAccountants.filter(
    (a) => a.active && a.role === "accountant"
  );

  const reportMessage = buildReportMessage(report, {
    violations,
    previous,
    weeklyReport,
    sheetUrl: process.env.REPORT_SHEET_URL,
  });
  const botReady = telegramConfigured();

  const periodLabel =
    resolved.from === resolved.to
      ? fmtDay(resolved.from)
      : `${fmtDay(resolved.from)} — ${fmtDay(resolved.to)}`;

  const perAccountantMsgs = accountantsToMessage(report).map((name) => ({
    name,
    text: buildAccountantMessage(report, name, { date: resolved.to }),
    critCount: report.criticalChats.filter((c) => c.accountant === name).length,
    waitingCount: (report.unansweredChats ?? []).filter((c) => c.accountant === name).length,
  }));

  const isWeek = isWeekFromMonday(resolved.from, resolved.to);
  const isMultiDay = resolved.from !== resolved.to;

  // For the weekly summary, compare against the previous full Mon–Sun week
  // regardless of how many days the current window covers.
  const prevWeekReport = isWeek
    ? await getReport({
        from: addDays(resolved.from, -7),
        to: addDays(resolved.from, -1),
        accountant: filters.accountant,
      })
    : null;
  const weeklyMessage = isWeek
    ? buildWeeklyReportMessage(
        report,
        prevWeekReport && prevWeekReport.totals.evaluatedChats > 0
          ? prevWeekReport
          : previous ?? null
      )
    : null;

  // ── Spreadsheet grid data (unified for single-day and multi-day) ───────────
  const periodDates = rangeDates(resolved.from, resolved.to);

  // Per-accountant per-day lookup: key = "date|accountant"
  const dayAccScoreMap = new Map<string, { score: number; count: number; lowCount: number }>();
  if (isMultiDay && report.perDayPerAccountant) {
    for (const d of report.perDayPerAccountant) {
      dayAccScoreMap.set(`${d.date}|${d.accountant}`, {
        score: d.avgScore,
        count: d.count,
        lowCount: d.lowCount,
      });
    }
  } else {
    for (const a of report.perAccountant) {
      dayAccScoreMap.set(`${resolved.from}|${a.accountant}`, {
        score: a.avgScore,
        count: a.count,
        lowCount: a.lowCount,
      });
    }
  }

  // Per-day summary lookup
  const dayMap = new Map<string, DaySummary>();
  if (isMultiDay && report.perDay) {
    for (const d of report.perDay) dayMap.set(d.date, d);
  } else {
    dayMap.set(resolved.from, {
      date: resolved.from,
      activeChats: report.totals.activeChats,
      evaluatedChats: report.totals.evaluatedChats,
      newChats: report.totals.newChats,
      distribution: report.distribution,
      serviceQualityPct: report.serviceQualityPct,
    });
  }

  // All active accountants in canonical order
  const periodAccountants = canonicalAccountants.map((a) => a.name);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Сообщение для Telegram</h1>
        <p className="text-sm text-gray-500">
          Аналитика за <span className="font-medium">{periodLabel}</span>
          {previous ? " · с трендом к прошлому периоду" : ""}.{" "}
          {botReady
            ? "Бот настроен — кнопка «Отправить в Telegram» активна."
            : "Бот не настроен (задайте TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)."}
        </p>
      </div>

      {/* Analytics message card */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Аналитика качества</div>
          <div className="flex gap-2">
            <CopyButton label="Копировать отчёт" className="btn-primary" text={reportMessage} />
            <SendTelegramButton text={reportMessage} configured={botReady} />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{reportMessage}
        </pre>
      </div>

      {/* Weekly report — shown for any period starting on Monday */}
      {isWeek && weeklyMessage && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">📊 Еженедельный отчёт для Эмилии</div>
            <CopyButton label="Копировать отчёт" className="btn-primary" text={weeklyMessage} />
          </div>
          <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{weeklyMessage}
          </pre>
        </div>
      )}

      {/* ── Spreadsheet monitoring grid (single-day and multi-day) ────────────── */}
      {periodAccountants.length > 0 && (
        <div id="comparison-section" className="card overflow-x-auto">
          <div className="print-only px-3 pt-3 pb-1 text-sm text-gray-500">{periodLabel}</div>
          <div className="flex justify-end px-3 pt-2 pb-1 no-print">
            <PrintComparisonButton />
          </div>

          <table className="text-xs border-collapse w-full">
            <thead>
              {/* Row 1: date group headers */}
              <tr className="bg-gradient-to-b from-gray-100 to-gray-50">
                <th rowSpan={2} className="sticky left-0 z-20 px-3 py-2 border border-gray-300 bg-gradient-to-b from-gray-100 to-gray-50 text-left font-semibold whitespace-nowrap min-w-[160px]">
                  Бухгалтер
                </th>
                {periodDates.map((d) => (
                  <th key={d} colSpan={3} className="px-2 py-2 border border-gray-300 bg-gradient-to-b from-gray-100 to-gray-50 font-semibold text-center whitespace-nowrap">
                    {fmtShortDate(d)}
                  </th>
                ))}
                {isMultiDay && (
                  <th colSpan={2} rowSpan={2} className="px-2 py-2 border border-gray-300 bg-gradient-to-b from-gray-100 to-gray-50 font-semibold text-center whitespace-nowrap">
                    Итого
                  </th>
                )}
              </tr>
              {/* Row 2: sub-column labels */}
              <tr className="bg-gradient-to-b from-gray-100 to-gray-50">
                {periodDates.flatMap((d) => [
                  <th key={`${d}-pct`} className="w-10 px-1 py-1.5 border border-gray-300 bg-gradient-to-b from-gray-100 to-gray-50 text-center text-gray-500 font-medium text-[11px]">%</th>,
                  <th key={`${d}-bad`} className="w-5 px-0.5 py-1.5 border border-gray-300 bg-gradient-to-b from-gray-100 to-gray-50 text-center text-gray-500 font-medium text-[11px]">⚠</th>,
                  <th key={`${d}-n`} className="w-5 px-0.5 py-1.5 border border-gray-300 bg-gradient-to-b from-gray-100 to-gray-50 text-center text-gray-500 font-medium text-[11px]">N</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {/* ── Summary rows ──────────────────────────────────────────────── */}

              {/* Активных чатов */}
              <tr className="bg-blue-50/40 hover:bg-blue-50/60">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-blue-50/40 whitespace-nowrap font-medium">Активных чатов</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-blue-50/40">
                      {day?.activeChats !== undefined ? <span className="font-medium">{day.activeChats}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-blue-50/40">
                    <span className="font-medium">{report.totals.activeChats}</span>
                  </td>
                )}
              </tr>

              {/* Новых чатов */}
              <tr className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-white whitespace-nowrap font-medium">Новых чатов</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-white">
                      {day?.newChats !== undefined ? <span className="font-medium">{day.newChats}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-white">
                    <span className="font-medium">{report.totals.newChats}</span>
                  </td>
                )}
              </tr>

              {/* Чаты без ответственных / Нет НУНН */}
              <tr className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-white whitespace-nowrap text-gray-600">Чаты без ответственных / Нет НУНН</td>
                {periodDates.map((d) => (
                  <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center text-gray-300 bg-white">—</td>
                ))}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-white">
                    {report.totals.chatsWithoutResponsible > 0
                      ? <span className="font-medium text-red-600">{report.totals.chatsWithoutResponsible}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                )}
              </tr>

              {/* Нет ссылки на чаты */}
              <tr className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-white whitespace-nowrap text-gray-600">Нет ссылки на чаты (активные)</td>
                {periodDates.map((d) => (
                  <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center text-gray-300 bg-white">—</td>
                ))}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center text-gray-300 bg-white">—</td>
                )}
              </tr>

              {/* Оценено чатов всего */}
              <tr className="font-semibold bg-blue-50/60 hover:bg-blue-50/80">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-blue-50/60 whitespace-nowrap">Оценено чатов всего</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-blue-50/60">
                      {day ? day.evaluatedChats : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-blue-50/60">
                    {report.totals.evaluatedChats}
                  </td>
                )}
              </tr>

              {/* Отлично */}
              <tr className="hover:bg-green-100/30">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-green-50 whitespace-nowrap font-medium text-green-900">Отлично</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-green-50 font-medium">
                      {day ? day.distribution.Отлично : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-green-50 font-medium">
                    {report.distribution.Отлично}
                  </td>
                )}
              </tr>

              {/* Хорошо */}
              <tr className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-white whitespace-nowrap font-medium">Хорошо</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-white font-medium">
                      {day ? day.distribution.Хорошо : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-white font-medium">
                    {report.distribution.Хорошо}
                  </td>
                )}
              </tr>

              {/* Плохо */}
              <tr className="hover:bg-yellow-100/30">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-yellow-50 whitespace-nowrap font-medium text-yellow-900">Плохо</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-yellow-50 font-medium">
                      {day ? day.distribution.Плохо : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-yellow-50 font-medium">
                    {report.distribution.Плохо}
                  </td>
                )}
              </tr>

              {/* Критично */}
              <tr className="hover:bg-red-100/30">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-red-50 whitespace-nowrap font-medium text-red-900">Критично</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className="px-2 py-2 border border-gray-300 text-center bg-red-50 font-medium">
                      {day ? day.distribution.Критично : <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className="px-2 py-2 border border-gray-300 text-center bg-red-50 font-medium">
                    {report.distribution.Критично}
                  </td>
                )}
              </tr>

              {/* Сервис Бухгалтерии */}
              <tr className="font-bold border-t-4 border-gray-400 bg-gradient-to-b from-indigo-50 to-indigo-25">
                <td className="sticky left-0 z-10 px-3 py-2.5 border border-gray-400 bg-gradient-to-b from-indigo-50 to-indigo-25 whitespace-nowrap text-indigo-900">Сервис Бухгалтерии</td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} colSpan={3} className={`px-2 py-2.5 border border-gray-400 text-center font-bold ${day ? scoreCellClass(day.serviceQualityPct) : "bg-indigo-50 text-gray-300"}`}>
                      {day ? day.serviceQualityPct : "—"}
                    </td>
                  );
                })}
                {isMultiDay && (
                  <td colSpan={2} className={`px-2 py-2.5 border border-gray-400 text-center font-bold ${scoreCellClass(report.serviceQualityPct)}`}>
                    {report.serviceQualityPct}
                  </td>
                )}
              </tr>

              {/* Separator */}
              <tr>
                <td colSpan={1 + periodDates.length * 3 + (isMultiDay ? 2 : 0)} className="h-1 bg-gray-300 border-none" />
              </tr>

              {/* ── Per-accountant rows ────────────────────────────────────────── */}
              {periodAccountants.map((acc, idx) => {
                const accData = report.perAccountant.find((a) => a.accountant === acc);
                const isAlternate = idx % 2 === 1;
                return (
                  <tr key={acc} className={`font-medium ${isAlternate ? "bg-gray-50/50" : "hover:bg-gray-50"}`}>
                    <td className={`sticky left-0 z-10 px-3 py-2 border border-gray-300 whitespace-nowrap font-semibold ${isAlternate ? "bg-gray-50/50" : "bg-white"}`}>{acc}</td>
                    {periodDates.flatMap((d) => {
                      const cell = dayAccScoreMap.get(`${d}|${acc}`);
                      return [
                        <td key={`${d}-s`} className={`px-2 py-2 border border-gray-300 text-center font-medium ${cell && cell.score >= 0 ? scoreCellClass(cell.score) : (isAlternate ? "bg-gray-50/50" : "bg-white")}`}>
                          {cell && cell.score >= 0 ? cell.score : <span className="text-gray-200">—</span>}
                        </td>,
                        <td key={`${d}-b`} className={`px-1 py-2 border border-gray-300 text-center ${cell?.lowCount ? "text-rose-600 font-bold" : "text-gray-300"} ${isAlternate ? "bg-gray-50/50" : "bg-white"}`}>
                          {cell?.lowCount || ""}
                        </td>,
                        <td key={`${d}-n`} className={`px-1 py-2 border border-gray-300 text-center text-gray-400 font-medium ${isAlternate ? "bg-gray-50/50" : "bg-white"}`}>
                          {cell && cell.score >= 0 ? cell.count : ""}
                        </td>,
                      ];
                    })}
                    {isMultiDay && [
                      <td key="total-s" className={`px-2 py-2 border border-gray-300 text-center font-bold ${accData && accData.avgScore >= 0 ? scoreCellClass(accData.avgScore) : (isAlternate ? "bg-gray-50/50" : "bg-white")}`}>
                        {accData && accData.avgScore >= 0 ? accData.avgScore : <span className="text-gray-300">—</span>}
                      </td>,
                      <td key="total-n" className={`px-1 py-2 border border-gray-300 text-center text-gray-400 font-medium ${isAlternate ? "bg-gray-50/50" : "bg-white"}`}>
                        {accData ? accData.count : ""}
                      </td>,
                    ]}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-accountant messages */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Сообщения бухгалтерам</h2>
          <span className="text-xs text-gray-500">
            {perAccountantMsgs.length > 0
              ? `${perAccountantMsgs.length} — есть что отправить`
              : "нет критичных / проблемных чатов за период"}
          </span>
        </div>
        {perAccountantMsgs.length === 0 ? (
          <div className="card p-4 text-sm text-gray-500">
            За {periodLabel} ни у кого нет критичных чатов, низких оценок или чатов без
            ответа. Отправлять отдельные сообщения не нужно.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {perAccountantMsgs.map(({ name, text, critCount, waitingCount }) => (
              <div key={name} className="card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{name}</span>
                    {critCount > 0 && (
                      <span className="inline-block rounded bg-rose-100 text-rose-700 font-semibold px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                        ⛔️ {critCount}
                      </span>
                    )}
                    {waitingCount > 0 && (
                      <span className="inline-block rounded bg-orange-100 text-orange-700 font-semibold px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                        ⏳ {waitingCount}
                      </span>
                    )}
                  </div>
                  <CopyButton
                    label="Копировать"
                    className="btn-primary !py-0.5 !px-2 text-xs shrink-0"
                    text={text}
                  />
                </div>
                <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{text}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
