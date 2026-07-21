import {
  countClientRequests,
  getDailyAnalytics,
  getReport,
  getViolationWorkflowReport,
  listAccountants,
  listViolations,
} from "@/lib/repo";
import { mondayOf } from "@/lib/scoring";
import { addDays, type DaySummary } from "@/lib/report";
import {
  accountantsToMessage,
  buildAccountantMessage,
  buildFridayFinesMessage,
  buildMonthlyFinesMessage,
  buildMargaritaWorkReportMessage,
  buildReportMessage,
  buildWeeklyReportMessage,
  buildWeeklyViolationHistory,
  telegramConfigured,
} from "@/lib/templates";
import { computeViolationFines } from "@/lib/violations";
import { dailyViolationRows } from "@/lib/violation-report";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";
import PrintComparisonButton from "@/components/PrintComparisonButton";

export const dynamic = "force-dynamic";

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
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
  // Ежедневный отчёт — по умолчанию за ПОСЛЕДНИЙ ОЦЕНЁННЫЙ день: если Маргарита
  // уже оценила чаты сегодня, это сегодня; если за сегодня ещё нет ни одной
  // оценки, показываем последний день с оценками (напр. вчера), а НЕ пустой
  // отчёт «0% сервиса / без звезды дня». Раньше страница жёстко брала «сегодня»,
  // из-за чего до первой оценки за день отчёт показывал 0% при живых запросах.
  // Разрешение окна делает getDailyAnalytics (берёт max(checking_date)); явные
  // даты из фильтра по-прежнему в приоритете.
  const filters = {
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  const [{ report, resolved }, allAccountants] = await Promise.all([
    getDailyAnalytics(filters),
    listAccountants(),
  ]);

  const isMultiDay = resolved.from !== resolved.to;

  // Fetch violations (window + week for the пятничного отчёта + month-to-date
  // for the «итого» fine totals), the week-scoped reports for the Armenian
  // weekly summary, and client-request counts in parallel. The weekly summary
  // no longer depends on the page filter being a Monday-started week — it is
  // ALWAYS built over the week containing the reported day (Mon → that day)
  // vs the previous full week, so the Friday report is ready on any view.
  const monthStart = `${resolved.to.slice(0, 7)}-01`;
  const weekStart = mondayOf(resolved.to);
  const yearStart = `${resolved.to.slice(0, 4)}-01-01`;
  // Ежедневные нарушения теперь берём из исправленного аудита (см. ниже), а не
  // из БД — здесь тянем только недельные / месячные / годовые срезы для
  // пятничного и месячного отчётов, которые считаются по правилам «Условия».
  const [weekViolations, monthViolations, yearViolations, thisWeekReport, prevWeekReport, requests] =
    await Promise.all([
      listViolations({ from: weekStart, to: resolved.to, accountant: filters.accountant }),
      listViolations({ from: monthStart, to: resolved.to, accountant: filters.accountant }),
      listViolations({ from: yearStart, to: resolved.to, accountant: filters.accountant }),
      getReport({ from: weekStart, to: resolved.to, accountant: filters.accountant }),
      getReport({
        from: addDays(weekStart, -7),
        to: addDays(weekStart, -1),
        accountant: filters.accountant,
      }),
      countClientRequests(resolved.from, resolved.to),
    ]);

  const canonicalAccountants = allAccountants.filter(
    (a) => a.active && a.role === "accountant"
  );
  const rosterNames = canonicalAccountants.map((a) => a.name);
  const requestDays = rangeDates(resolved.from, resolved.to).length;

  // Грубое escalation baselines: this-year counts per accountant BEFORE the
  // window («1-е за год — предупреждение, 2-е — 10 000, 3-е — 30 000»).
  const grossCountBefore = (cutoff: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const v of yearViolations) {
      if (!v.accountant || v.vdate >= cutoff) continue;
      if (!(v.severity ?? "").toLowerCase().includes("груб")) continue;
      out[v.accountant] = (out[v.accountant] ?? 0) + 1;
    }
    return out;
  };

  // Month-to-date fine totals per accountant («итого за месяц … драм»),
  // computed from the «Условия» rules (manual sanction on a violation wins).
  const monthFines = computeViolationFines(
    monthViolations.filter((v) => v.accountant),
    { grossPrior: grossCountBefore(monthStart) }
  );
  const monthFineTotals: Record<string, number> = {};
  monthViolations
    .filter((v) => v.accountant)
    .forEach((v, i) => {
      if (monthFines[i] > 0) {
        monthFineTotals[v.accountant as string] =
          (monthFineTotals[v.accountant as string] ?? 0) + monthFines[i];
      }
    });

  // Нарушения для ежедневного отчёта — ЖИВЫЕ данные (mqa_violations), строго за
  // день отчёта [resolved.from..resolved.to]. Один блок = одно нарушение,
  // предупреждение/штраф по единому правилу (violations.ts): 1-е за день —
  // предупреждение (0 др), повторное — 1 000 др, ручная санкция перебивает.
  // Тот же источник и та же логика, что на дашборде — без ИИ и без Excel-выгрузок.
  const dailyRowsAll = await listViolations({
    from: resolved.from,
    to: resolved.to,
    accountant: filters.accountant,
  });
  // Только ПОДТВЕРЖДЁННЫЕ Маргаритой нарушения попадают в ежедневный отчёт —
  // авто-импортированные (confirmed === false) исключаем.
  const dailyRows = dailyRowsAll.filter((v) => v.confirmed !== false);
  const { violations: dailyViolations } = dailyViolationRows(dailyRows);

  // Ежедневный отчёт — СТРОГО за один день: «Нарушения» и «Кол-во запросов за
  // день» показывают только текущий день (dailyViolations = auditDailyViolations
  // за [resolved.from..resolved.to], requests — за тот же день). Недельная
  // разбивка нарушений сюда НЕ подмешивается — она путала бухгалтеров; недельные
  // штрафы живут отдельно в пятничном отчёте (fridayMessage) ниже.
  const reportMessage = buildReportMessage(report, {
    violations: dailyViolations,
    sheetUrl: process.env.REPORT_SHEET_URL,
    roster: rosterNames,
    requests,
    requestDays,
  });

  // Weekly fines block (Mon → the reported day) — appended to the Armenian
  // weekly summary so the Friday message is ONE text with the money included.
  // Недельная история нарушений по дням (п.10) — тот же источник (mqa_violations)
  // и движок, что дашборд/PDF, поэтому недельный итог совпадает.
  const weeklyViolationHistory = buildWeeklyViolationHistory(weekViolations, {
    weekFrom: weekStart,
    weekTo: resolved.to,
  });
  const fridayMessage = buildFridayFinesMessage(weekViolations, {
    weekFrom: weekStart,
    weekTo: resolved.to,
    monthFineTotals,
    roster: rosterNames,
    grossPrior: grossCountBefore(weekStart),
  });
  // Ежемесячный отчёт по штрафам — one block per person (chat code — problem
  // — money) over the month-to-date window, with the grand totals at the end.
  // Same «Условия» pricing as the Friday report, so the figures always agree.
  const monthlyMessage = buildMonthlyFinesMessage(monthViolations, {
    monthFrom: monthStart,
    monthTo: resolved.to,
    roster: rosterNames,
    grossPrior: grossCountBefore(monthStart),
  });
  // The reminder badge must reflect the ACTUAL calendar day (Yerevan time),
  // not resolved.to — which defaults to the latest evaluated day and can lag
  // behind if nobody has scored anything yet today (e.g. still shows last
  // Friday on Monday morning).
  const nowYerevan = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Yerevan" })
  );
  const isFriday = nowYerevan.getDay() === 5;
  const botReady = telegramConfigured();

  const periodLabel =
    resolved.from === resolved.to
      ? fmtDay(resolved.from)
      : `${fmtDay(resolved.from)} — ${fmtDay(resolved.to)}`;

  // «Апелляции и QA Маргариты» — appeals + acknowledgement section of the daily
  // Telegram report (Phase 6). Same aggregation as /work-report & /dashboard.
  // On a load failure we DO NOT fall back to a zero-filled message (that would
  // send misleading zeros) — we surface the error and disable the send button.
  let margaritaWorkMessage: string | null = null;
  let margaritaWorkError: string | null = null;
  try {
    const flow = await getViolationWorkflowReport({
      from: resolved.from,
      to: resolved.to,
      accountant: filters.accountant,
    });
    margaritaWorkMessage = buildMargaritaWorkReportMessage(flow, {
      date: resolved.to,
      activeChats: report.totals.activeChats,
    });
  } catch (e) {
    margaritaWorkError = e instanceof Error ? e.message : "Не удалось загрузить данные";
  }

  const perAccountantMsgs = accountantsToMessage(report).map((name) => ({
    name,
    text: buildAccountantMessage(report, name, { date: resolved.to }),
    critCount: report.criticalChats.filter((c) => c.accountant === name).length,
  }));

  // The Armenian weekly summary — this week (Mon → reported day) against the
  // previous full Mon–Sun week — plus the fines block with the computed money.
  // ONE message, one card: this is THE пятничный отчёт.
  const weeklyMessage =
    buildWeeklyReportMessage(
      thisWeekReport,
      prevWeekReport.totals.evaluatedChats > 0 ? prevWeekReport : null,
      { roster: rosterNames }
    ) +
    "\n\n" +
    fridayMessage;

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
          Ежедневный отчет за <span className="font-medium">{periodLabel}</span>.{" "}
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
            <a
              className="btn-secondary"
              href={`/api/report/pdf?from=${resolved.from}&to=${resolved.to}&period=daily`}
            >
              📄 PDF (день)
            </a>
            <SendTelegramButton
              text={reportMessage}
              configured={botReady}
              pdfPeriod={{ from: resolved.from, to: resolved.to, period: "daily" }}
            />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{reportMessage}
        </pre>
      </div>

      {/* Апелляции и QA Маргариты — апелляции и ознакомления (Phase 6). */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">🧾 Апелляции и QA Маргариты</div>
          {margaritaWorkMessage && (
            <div className="flex gap-2">
              <CopyButton label="Копировать" className="btn-primary" text={margaritaWorkMessage} />
              <SendTelegramButton
                text={margaritaWorkMessage}
                configured={botReady}
                label="Отправить в Telegram"
                chat="margarita"
              />
            </div>
          )}
        </div>
        {margaritaWorkError ? (
          <div className="text-sm text-red-700 bg-red-50 rounded p-3 border border-red-100">
            Не удалось загрузить данные по работе за день ({margaritaWorkError}). Отчёт
            не отправляется, чтобы не показать ложные нули — обновите страницу или
            попробуйте позже.
          </div>
        ) : (
          <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{margaritaWorkMessage}
          </pre>
        )}
      </div>

      {/* Пятничный отчёт — the Armenian weekly summary (service %, movers,
          problems, roster week-over-week, star of the week). Always visible. */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">
            📊 Пятничный отчёт (еженедельный)
            {isFriday && (
              <span className="ml-2 inline-block rounded bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 text-[11px]">
                сегодня пятница — пора отправлять
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <CopyButton label="Копировать отчёт" className="btn-primary" text={weeklyMessage} />
            <a
              className="btn-secondary"
              href={`/api/report/pdf?from=${resolved.from}&to=${resolved.to}&period=weekly`}
            >
              📄 PDF (неделя)
            </a>
            <SendTelegramButton
              text={weeklyMessage}
              configured={botReady}
              label="Отправить в Telegram"
              pdfPeriod={{ from: resolved.from, to: resolved.to, period: "weekly" }}
            />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{weeklyMessage}
        </pre>
      </div>

      {/* Недельная история нарушений по дням (п.10) — для руководства. */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">🗓 История нарушений за неделю (по дням)</div>
          <div className="flex gap-2">
            <CopyButton label="Копировать" className="btn-primary" text={weeklyViolationHistory} />
            <SendTelegramButton
              text={weeklyViolationHistory}
              configured={botReady}
              label="Отправить в Telegram"
            />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{weeklyViolationHistory}
        </pre>
      </div>

      {/* Ежемесячный отчёт по штрафам — per-person blocks (chat code — problem
          — money) with the grand totals. Always visible. */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">💰 Ежемесячный отчет по штрафам</div>
          <div className="flex gap-2">
            <CopyButton label="Копировать отчёт" className="btn-primary" text={monthlyMessage} />
            <SendTelegramButton
              text={monthlyMessage}
              configured={botReady}
              label="Отправить в Telegram"
            />
          </div>
        </div>
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{monthlyMessage}
        </pre>
      </div>

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
            {perAccountantMsgs.map(({ name, text, critCount }) => (
              <div key={name} className="card p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{name}</span>
                    {critCount > 0 && (
                      <span className="inline-block rounded bg-rose-100 text-rose-700 font-semibold px-1.5 py-0.5 text-[11px] whitespace-nowrap">
                        ⛔️ {critCount}
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
