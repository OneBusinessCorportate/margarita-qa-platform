import { getDailyAnalytics, listViolations } from "@/lib/repo";
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

/** Returns true when the filter spans exactly Mon–Sun (7 days). */
function isMonSunWeek(from?: string, to?: string): boolean {
  if (!from || !to) return false;
  try {
    const f = new Date(from + "T00:00:00Z");
    const t = new Date(to + "T00:00:00Z");
    const days = Math.round((t.getTime() - f.getTime()) / 86400000);
    return days === 6 && f.getUTCDay() === 1;
  } catch { return false; }
}

/** Returns ISO dates for each day in [from, to] (inclusive). */
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

const DAY_ABBR = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
function dayHeader(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return `${DAY_ABBR[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function scoreCellClass(score: number | undefined): string {
  if (score === undefined) return "text-gray-300 bg-white";
  if (score >= 98) return "bg-green-100 text-green-800 font-semibold";
  if (score >= 90) return "bg-yellow-50 text-yellow-800";
  if (score >= 80) return "bg-orange-50 text-orange-700";
  return "bg-red-50 text-red-700";
}

// The ONE place to copy/send the daily analytics — the dashboard links here
// instead of repeating the text and buttons. Accepts the same date / accountant
// query params as the dashboard so a specific day or range can be deep-linked;
// with no params it resolves to the latest day that actually has evaluations
// (a TRUE daily, not the whole-history aggregate the old page produced).
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

  const [{ report, previous, resolved }, violations] = await Promise.all([
    getDailyAnalytics(filters),
    listViolations({ from: filters.from, to: filters.to, accountant: filters.accountant }),
  ]);

  const reportMessage = buildReportMessage(report, {
    violations,
    previous,
    // Set REPORT_SHEET_URL (e.g. on Render) to append the Google-Sheet link.
    sheetUrl: process.env.REPORT_SHEET_URL,
  });
  const botReady = telegramConfigured();

  const periodLabel =
    resolved.from === resolved.to
      ? fmtDay(resolved.from)
      : `${fmtDay(resolved.from)} — ${fmtDay(resolved.to)}`;

  // Per-accountant messages (item 11): one ready-to-send block per person who has
  // a critical chat, a low average, or a chat still waiting. This is what
  // Margarita copies to send each bookkeeper directly — previously the page only
  // produced the single aggregate report, so per-person critical chats (e.g.
  // Olya's) had nowhere to be copied from.
  const perAccountant = accountantsToMessage(report).map((name) => ({
    name,
    text: buildAccountantMessage(report, name, { date: resolved.to }),
    critCount: report.criticalChats.filter((c) => c.accountant === name).length,
    waitingCount: (report.unansweredChats ?? []).filter((c) => c.accountant === name)
      .length,
  }));

  // Weekly report — shown when the filter is a full Mon–Sun week.
  const isWeek = isMonSunWeek(resolved.from, resolved.to);
  const isMultiDay = resolved.from !== resolved.to;
  const weeklyMessage = isWeek
    ? buildWeeklyReportMessage(report, previous ?? null)
    : null;

  // Per-day × per-accountant table data — shown for any multi-day period, not just Mon–Sun.
  const periodDates = isMultiDay ? rangeDates(resolved.from, resolved.to) : [];
  const dayAccScoreMap = new Map<string, { score: number; count: number }>();
  if (isMultiDay && report.perDayPerAccountant) {
    for (const d of report.perDayPerAccountant) {
      dayAccScoreMap.set(`${d.date}|${d.accountant}`, { score: d.avgScore, count: d.count });
    }
  }
  // Collect all accountants who appear in the period data, sorted by name
  const periodAccountants = isMultiDay
    ? [...new Set((report.perDayPerAccountant ?? []).map((d) => d.accountant))]
        .filter((a) => a !== "—")
        .sort((a, b) => a.localeCompare(b))
    : [];

  // Week-over-week comparison — available whenever there is a preceding period with data.
  const prevMap = previous
    ? new Map(previous.perAccountant.map((a) => [a.accountant, a.avgScore]))
    : new Map<string, number>();
  const comparisonRows = report.perAccountant
    .filter((a) => a.count > 0 && a.avgScore >= 0)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Stars of the week: accountants with ≥ 3 scored days all at 98+.
  const starsList: Array<{ name: string; desc: string }> = [];
  if (report.perDayPerAccountant && report.perDayPerAccountant.length > 0) {
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
        const desc = [...cnt.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([s, n]) => `${n}×${s}`)
          .join(", ");
        starsList.push({ name, desc });
      }
    }
  }

  // Indicators: unanswered chats + overdue tasks per accountant.
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
            : "Бот не настроен (задайте TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, чтобы включить отправку)."}
        </p>
      </div>

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

      {/* Weekly report card — shown when a full Mon–Sun week is selected. */}
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

      {/* Per-day × per-accountant visual table — shown for any multi-day period. */}
      {isMultiDay && periodAccountants.length > 0 && (
        <div className="card p-3 space-y-2 overflow-x-auto">
          <div className="text-sm font-medium">📅 Оценки по дням</div>
          <table className="text-xs border-collapse min-w-full">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium whitespace-nowrap">
                  Бухгалтер
                </th>
                {periodDates.map((d) => (
                  <th
                    key={d}
                    className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium text-center whitespace-nowrap"
                  >
                    {dayHeader(d)}
                  </th>
                ))}
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium text-center whitespace-nowrap">
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {periodAccountants.map((acc) => {
                const accData = report.perAccountant.find((a) => a.accountant === acc);
                return (
                  <tr key={acc}>
                    <td className="px-2 py-1.5 border border-gray-200 font-medium whitespace-nowrap">
                      {acc}
                    </td>
                    {periodDates.map((d) => {
                      const cell = dayAccScoreMap.get(`${d}|${acc}`);
                      return (
                        <td
                          key={d}
                          className={`px-2 py-1.5 border border-gray-200 text-center ${scoreCellClass(cell?.score)}`}
                        >
                          {cell !== undefined ? (
                            <>
                              {cell.score}
                              <span className="text-[9px] text-gray-400 ml-0.5">{cell.count}</span>
                            </>
                          ) : "—"}
                        </td>
                      );
                    })}
                    <td
                      className={`px-2 py-1.5 border border-gray-200 text-center font-semibold ${scoreCellClass(accData?.avgScore)}`}
                    >
                      {accData && accData.avgScore >= 0 ? (
                        <>
                          {accData.avgScore}
                          <span className="text-[9px] text-gray-400 ml-0.5">{accData.count}</span>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400">
            🟩 ≥ 98% · 🟨 90–97% · 🟧 80–89% · 🟥 &lt; 80% · маленькая цифра — кол-во оценок
          </p>
        </div>
      )}

      {/* Visual week-over-week comparison — shown whenever a preceding period exists. */}
      {previous && comparisonRows.length > 0 && (
        <div id="comparison-section" className="card p-3 space-y-3">
          <div className="print-only mb-2">
            <div className="text-base font-bold">📊 Сравнение с предыдущим периодом</div>
            <div className="text-sm text-gray-500">{periodLabel}</div>
          </div>
          <div className="flex items-center justify-between gap-2 no-print">
            <div className="text-sm font-medium">📊 Сравнение с предыдущим периодом</div>
            <PrintComparisonButton />
          </div>

          {/* Service quality bar */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">
              Прошлый период:{" "}
              <span className={`font-semibold ${scoreCellClass(previous.serviceQualityPct).replace("border border-gray-200", "")}`}>
                {previous.serviceQualityPct}%
              </span>
            </span>
            <span className="text-gray-500">
              Этот период:{" "}
              <span className={`font-semibold ${scoreCellClass(report.serviceQualityPct).replace("border border-gray-200", "")}`}>
                {report.serviceQualityPct}%
              </span>
            </span>
            {(() => {
              const delta = Math.round((report.serviceQualityPct - previous.serviceQualityPct) * 10) / 10;
              return (
                <span className={delta > 0 ? "text-green-600 font-semibold" : delta < 0 ? "text-red-600 font-semibold" : "text-gray-400"}>
                  {delta > 0 ? `▲ +${delta} п.п.` : delta < 0 ? `▼ ${delta} п.п.` : "→ без изменений"}
                </span>
              );
            })()}
          </div>

          {/* Per-accountant comparison table */}
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="text-left px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium">Бухгалтер</th>
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium text-center whitespace-nowrap">Прошлый</th>
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium text-center whitespace-nowrap">Этот</th>
                <th className="px-2 py-1.5 border border-gray-200 bg-gray-50 font-medium text-center whitespace-nowrap">Изменение</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((a) => {
                const prev = prevMap.get(a.accountant);
                const delta = prev !== undefined ? Math.round((a.avgScore - prev) * 10) / 10 : null;
                return (
                  <tr key={a.accountant}>
                    <td className="px-2 py-1.5 border border-gray-200 font-medium whitespace-nowrap">{a.accountant}</td>
                    <td className={`px-2 py-1.5 border border-gray-200 text-center ${scoreCellClass(prev)}`}>
                      {prev !== undefined ? prev : "—"}
                    </td>
                    <td className={`px-2 py-1.5 border border-gray-200 text-center font-semibold ${scoreCellClass(a.avgScore)}`}>
                      {a.avgScore}
                    </td>
                    <td className={`px-2 py-1.5 border border-gray-200 text-center font-semibold ${
                      delta === null ? "text-gray-300" :
                      delta > 0 ? "text-green-600 bg-green-50" :
                      delta < 0 ? "text-red-600 bg-red-50" : "text-gray-400"
                    }`}>
                      {delta === null ? "—" : delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : "→"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Stars of the period */}
          {starsList.length > 0 && (
            <div className="pt-1 space-y-1">
              <div className="text-xs font-semibold text-yellow-700">⭐ Звёзды периода</div>
              <div className="flex flex-wrap gap-2">
                {starsList.map(({ name, desc }) => (
                  <span key={name} className="inline-flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2.5 py-1 text-xs font-medium text-yellow-800">
                    🌟 {name} <span className="text-yellow-600">({desc})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Indicators: unanswered + overdue */}
          {(unansweredByAcc.size > 0 || overdueByAcc.size > 0) && (
            <div className="pt-1 space-y-1 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-600">Индикаторы</div>
              <div className="flex flex-wrap gap-3 text-xs">
                {unansweredByAcc.size > 0 && (
                  <div className="space-y-0.5">
                    <div className="font-medium text-orange-700">
                      ⏳ Незакрытый запрос клиента ({[...unansweredByAcc.values()].reduce((s, n) => s + n, 0)})
                    </div>
                    {[...unansweredByAcc.entries()].sort((a, b) => b[1] - a[1]).map(([acc, n]) => (
                      <div key={acc} className="text-gray-600 pl-2">• {acc}: {n}</div>
                    ))}
                  </div>
                )}
                {overdueByAcc.size > 0 && (
                  <div className="space-y-0.5">
                    <div className="font-medium text-red-700">
                      ❗ Несвоевременная обратная связь по задачам ({[...overdueByAcc.values()].reduce((s, n) => s + n, 0)})
                    </div>
                    {[...overdueByAcc.entries()].sort((a, b) => b[1] - a[1]).map(([acc, n]) => (
                      <div key={acc} className="text-gray-600 pl-2">• {acc}: {n}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-accountant messages — copy and send each bookkeeper directly. */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Сообщения бухгалтерам</h2>
          <span className="text-xs text-gray-500">
            {perAccountant.length > 0
              ? `${perAccountant.length} — есть что отправить`
              : "нет критичных / проблемных чатов за период"}
          </span>
        </div>
        {perAccountant.length === 0 ? (
          <div className="card p-4 text-sm text-gray-500">
            За {periodLabel} ни у кого нет критичных чатов, низких оценок или чатов без
            ответа. Отправлять отдельные сообщения не нужно.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {perAccountant.map(({ name, text, critCount, waitingCount }) => (
              <div key={name} className="card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{name}</span>
                    {critCount > 0 && (
                      <span className="inline-block rounded bg-red-100 text-red-700 font-semibold px-1.5 py-0.5 text-[11px] whitespace-nowrap">
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
