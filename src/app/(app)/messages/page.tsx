import { getDailyAnalytics, listAccountants, listViolations } from "@/lib/repo";
import type { DaySummary } from "@/lib/report";
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

function isMonSunWeek(from?: string, to?: string): boolean {
  if (!from || !to) return false;
  try {
    const f = new Date(from + "T00:00:00Z");
    const t = new Date(to + "T00:00:00Z");
    const days = Math.round((t.getTime() - f.getTime()) / 86400000);
    return days === 6 && f.getUTCDay() === 1;
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
  const filters = {
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  const [{ report, previous, resolved }, violations, allAccountants] = await Promise.all([
    getDailyAnalytics(filters),
    listViolations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
    listAccountants(),
  ]);

  const canonicalAccountants = allAccountants.filter(
    (a) => a.active && a.role === "accountant"
  );

  const reportMessage = buildReportMessage(report, {
    violations,
    previous,
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

  const isWeek = isMonSunWeek(resolved.from, resolved.to);
  const isMultiDay = resolved.from !== resolved.to;
  const weeklyMessage = isWeek ? buildWeeklyReportMessage(report, previous ?? null) : null;

  // ── Multi-day spreadsheet data ─────────────────────────────────────────────
  const periodDates = isMultiDay ? rangeDates(resolved.from, resolved.to) : [];

  // Per-accountant per-day scores
  const dayAccScoreMap = new Map<string, { score: number; count: number }>();
  if (isMultiDay && report.perDayPerAccountant) {
    for (const d of report.perDayPerAccountant) {
      dayAccScoreMap.set(`${d.date}|${d.accountant}`, { score: d.avgScore, count: d.count });
    }
  }

  // Per-day summary (distribution + service %)
  const dayMap = new Map<string, DaySummary>();
  if (isMultiDay && report.perDay) {
    for (const d of report.perDay) dayMap.set(d.date, d);
  }

  // Accountants in canonical DB order (matches the source spreadsheet row order)
  const periodAccountants = isMultiDay
    ? canonicalAccountants.map((a) => a.name)
    : [];

  // ── Single-day comparison data ─────────────────────────────────────────────
  const prevMap = previous
    ? new Map(previous.perAccountant.map((a) => [a.accountant, a.avgScore]))
    : new Map<string, number>();

  const currentScoreMap = new Map(report.perAccountant.map((a) => [a.accountant, a]));
  // All active accountants in canonical order; those without evaluations show —
  const comparisonRows = filters.accountant
    ? report.perAccountant.filter((a) => a.accountant === filters.accountant && a.count > 0)
    : canonicalAccountants.map(
        (a) => currentScoreMap.get(a.name) ?? { accountant: a.name, avgScore: -1, count: 0, lowCount: 0 }
      );

  // Stars (used in single-day comparison section)
  const starsList: Array<{ name: string; desc: string }> = [];
  if (report.perDayPerAccountant?.length) {
    const accDays = new Map<string, number[]>();
    for (const d of report.perDayPerAccountant) {
      if (d.accountant === "—") continue;
      const s = accDays.get(d.accountant) ?? [];
      s.push(d.avgScore);
      accDays.set(d.accountant, s);
    }
    for (const [name, scores] of [...accDays.entries()].sort((a, b) => {
      const avgA = a[1].reduce((s, x) => s + x, 0) / a[1].length;
      const avgB = b[1].reduce((s, x) => s + x, 0) / b[1].length;
      return avgB - avgA || a[0].localeCompare(b[0]);
    })) {
      if (scores.length >= 3 && scores.every((s) => s >= 98)) {
        const cnt = new Map<number, number>();
        for (const s of scores) cnt.set(s, (cnt.get(s) ?? 0) + 1);
        const desc = [...cnt.entries()].sort((a, b) => b[0] - a[0]).map(([s, n]) => `${n}×${s}`).join(", ");
        starsList.push({ name, desc });
      }
    }
  }

  const unansweredByAcc = new Map<string, number>();
  for (const c of report.unansweredChats ?? []) {
    const k = c.accountant ?? "—";
    unansweredByAcc.set(k, (unansweredByAcc.get(k) ?? 0) + 1);
  }
  const overdueByAcc = new Map<string, number>();
  for (const t of report.tasks.perAccountant) {
    if (t.overdue > 0) overdueByAcc.set(t.accountant, t.overdue);
  }

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

      {/* Weekly report — shown for full Mon–Sun weeks */}
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

      {/* ── Spreadsheet view for multi-day periods ───────────────────────────── */}
      {isMultiDay && periodAccountants.length > 0 && (
        <div id="comparison-section" className="card overflow-x-auto">
          {/* Print-only header */}
          <div className="print-only px-3 pt-3 pb-1 text-sm text-gray-500">{periodLabel}</div>
          {/* PDF button */}
          <div className="flex justify-end px-3 pt-2 pb-1 no-print">
            <PrintComparisonButton />
          </div>

          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-gray-50 whitespace-nowrap min-w-[150px]" />
                {periodDates.map((d) => (
                  <th key={d} className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-semibold text-center whitespace-nowrap">
                    {fmtShortDate(d)}
                  </th>
                ))}
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-semibold text-center whitespace-nowrap">
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Активных чатов */}
              <tr>
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Активных чатов
                </td>
                {periodDates.map((d) => (
                  <td key={d} className="px-2 py-1.5 border border-gray-200 text-center text-gray-300 bg-white">—</td>
                ))}
                <td className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                  {report.totals.activeChats}
                </td>
              </tr>

              {/* Новых чатов */}
              <tr>
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Новых чатов
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                      {day?.newChats ?? <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                  {report.totals.newChats}
                </td>
              </tr>

              {/* Без ответственных */}
              <tr>
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Без ответственных
                </td>
                {periodDates.map((d) => (
                  <td key={d} className="px-2 py-1.5 border border-gray-200 text-center text-gray-300 bg-white">—</td>
                ))}
                <td className="px-2 py-1.5 border border-gray-200 text-center text-gray-300 bg-white">—</td>
              </tr>

              {/* Нет ссылки */}
              <tr>
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Нет ссылки
                </td>
                {periodDates.map((d) => (
                  <td key={d} className="px-2 py-1.5 border border-gray-200 text-center text-gray-300 bg-white">—</td>
                ))}
                <td className="px-2 py-1.5 border border-gray-200 text-center text-gray-300 bg-white">—</td>
              </tr>

              {/* Оценено чатов всего — bold */}
              <tr className="font-bold">
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Оценено чатов всего
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                      {day ? day.evaluatedChats : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                  {report.totals.evaluatedChats}
                </td>
              </tr>

              {/* Отлично */}
              <tr>
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Отлично
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                      {day?.distribution.Отлично ?? <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                  {report.distribution.Отлично}
                </td>
              </tr>

              {/* Хорошо — yellow row */}
              <tr className="bg-yellow-100">
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-yellow-100 whitespace-nowrap">
                  Хорошо
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className="px-2 py-1.5 border border-gray-200 text-center">
                      {day?.distribution.Хорошо ?? "—"}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 border border-gray-200 text-center">
                  {report.distribution.Хорошо}
                </td>
              </tr>

              {/* Плохо */}
              <tr>
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-white whitespace-nowrap">
                  Плохо
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                      {day?.distribution.Плохо ?? <span className="text-gray-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 border border-gray-200 text-center bg-white">
                  {report.distribution.Плохо}
                </td>
              </tr>

              {/* Критично — red row */}
              <tr className="bg-red-100">
                <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 bg-red-100 whitespace-nowrap">
                  Критично
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className="px-2 py-1.5 border border-gray-200 text-center">
                      {day?.distribution.Критично ?? "—"}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 border border-gray-200 text-center">
                  {report.distribution.Критично}
                </td>
              </tr>

              {/* Сервис Бухгалтерии — bold, score-coloured cells */}
              <tr className="font-bold border-t-2 border-gray-300">
                <td className="sticky left-0 z-10 px-3 py-2 border border-gray-300 bg-white whitespace-nowrap">
                  Сервис Бухгалтерии
                </td>
                {periodDates.map((d) => {
                  const day = dayMap.get(d);
                  return (
                    <td key={d} className={`px-2 py-2 border border-gray-300 text-center ${day ? scoreCellClass(day.serviceQualityPct) : "bg-white text-gray-300"}`}>
                      {day ? day.serviceQualityPct : "—"}
                    </td>
                  );
                })}
                <td className={`px-2 py-2 border border-gray-300 text-center ${scoreCellClass(report.serviceQualityPct)}`}>
                  {report.serviceQualityPct}
                </td>
              </tr>

              {/* Separator */}
              <tr>
                <td colSpan={periodDates.length + 2} className="h-2 bg-gray-100 border-t border-gray-200" />
              </tr>

              {/* Per-accountant rows */}
              {periodAccountants.map((acc) => {
                const accData = report.perAccountant.find((a) => a.accountant === acc);
                return (
                  <tr key={acc}>
                    <td className="sticky left-0 z-10 px-3 py-1.5 border border-gray-200 whitespace-nowrap bg-white">
                      {acc}
                    </td>
                    {periodDates.map((d) => {
                      const cell = dayAccScoreMap.get(`${d}|${acc}`);
                      return (
                        <td key={d} className={`px-1.5 py-1.5 border border-gray-200 text-center ${scoreCellClass(cell?.score)}`}>
                          {cell ? (
                            <>
                              {cell.score}
                              <sup className="text-[8px] opacity-50 ml-0.5">{cell.count}</sup>
                            </>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      );
                    })}
                    <td className={`px-2 py-1.5 border border-gray-200 text-center font-semibold ${scoreCellClass(accData?.avgScore)}`}>
                      {accData && accData.avgScore >= 0 ? (
                        <>
                          {accData.avgScore}
                          <sup className="text-[8px] opacity-50 ml-0.5">{accData.count}</sup>
                        </>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Single-day comparison with previous period ───────────────────────── */}
      {!isMultiDay && previous && report.perAccountant.some((a) => a.count > 0) && (
        <div id="comparison-section" className="card p-3 space-y-3">
          <div className="print-only mb-2">
            <div className="text-base font-bold">📊 Сравнение с предыдущим периодом</div>
            <div className="text-sm text-gray-500">{periodLabel}</div>
          </div>
          <div className="flex items-center justify-between gap-2 no-print">
            <div className="text-sm font-semibold">📊 Сравнение с предыдущим периодом</div>
            <PrintComparisonButton />
          </div>

          {/* Service quality bar */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">
              Прошлый:{" "}
              <span className="font-semibold">{previous.serviceQualityPct}%</span>
            </span>
            <span className="text-gray-500">
              Сегодня:{" "}
              <span className="font-semibold">{report.serviceQualityPct}%</span>
            </span>
            {(() => {
              const delta = Math.round((report.serviceQualityPct - previous.serviceQualityPct) * 10) / 10;
              return (
                <span className={delta > 0 ? "text-emerald-600 font-semibold" : delta < 0 ? "text-rose-600 font-semibold" : "text-slate-400"}>
                  {delta > 0 ? `▲ +${delta} п.п.` : delta < 0 ? `▼ ${delta} п.п.` : "→ без изменений"}
                </span>
              );
            })()}
          </div>

          {/* Per-accountant comparison table */}
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="text-left px-3 py-1.5 border border-gray-200 bg-gray-100 font-semibold">Бухгалтер</th>
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-100 font-semibold text-center whitespace-nowrap">Прошлый</th>
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-100 font-semibold text-center whitespace-nowrap">Сегодня</th>
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-100 font-semibold text-center whitespace-nowrap">Δ</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((a) => {
                const hasScore = a.count > 0;
                const prev = prevMap.get(a.accountant);
                const delta = hasScore && prev !== undefined
                  ? Math.round((a.avgScore - prev) * 10) / 10
                  : null;
                return (
                  <tr key={a.accountant}>
                    <td className="px-3 py-1.5 border border-gray-200 font-medium whitespace-nowrap">{a.accountant}</td>
                    <td className={`px-2 py-1.5 border border-gray-200 text-center ${scoreCellClass(prev)}`}>
                      {prev !== undefined ? prev : "—"}
                    </td>
                    <td className={`px-2 py-1.5 border border-gray-200 text-center ${hasScore ? scoreCellClass(a.avgScore) : ""}`}>
                      {hasScore ? a.avgScore : "—"}
                    </td>
                    <td className={`px-2 py-1.5 border border-gray-200 text-center font-semibold ${
                      delta === null ? "text-slate-300" :
                      delta > 0 ? "text-emerald-600 bg-emerald-50" :
                      delta < 0 ? "text-rose-600 bg-rose-50" : "text-slate-400"
                    }`}>
                      {delta === null ? "—" : delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : "→"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Stars */}
          {starsList.length > 0 && (
            <div className="pt-1 space-y-1">
              <div className="text-xs font-semibold text-amber-700">⭐ Звёзды периода</div>
              <div className="flex flex-wrap gap-2">
                {starsList.map(({ name, desc }) => (
                  <span key={name} className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-800">
                    🌟 {name} <span className="text-amber-600">({desc})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Indicators */}
          {(unansweredByAcc.size > 0 || overdueByAcc.size > 0) && (
            <div className="pt-1 space-y-1 border-t border-gray-100">
              <div className="text-xs font-semibold text-slate-600">Индикаторы</div>
              <div className="flex flex-wrap gap-3 text-xs">
                {unansweredByAcc.size > 0 && (
                  <div className="space-y-0.5">
                    <div className="font-medium text-orange-700">
                      ⏳ Без ответа клиенту ({[...unansweredByAcc.values()].reduce((s, n) => s + n, 0)})
                    </div>
                    {[...unansweredByAcc.entries()].sort((a, b) => b[1] - a[1]).map(([acc, n]) => (
                      <div key={acc} className="text-slate-600 pl-2">• {acc}: {n}</div>
                    ))}
                  </div>
                )}
                {overdueByAcc.size > 0 && (
                  <div className="space-y-0.5">
                    <div className="font-medium text-rose-700">
                      ❗ Просрочено задач ({[...overdueByAcc.values()].reduce((s, n) => s + n, 0)})
                    </div>
                    {[...overdueByAcc.entries()].sort((a, b) => b[1] - a[1]).map(([acc, n]) => (
                      <div key={acc} className="text-slate-600 pl-2">• {acc}: {n}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
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
