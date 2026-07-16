import Link from "next/link";
import {
  getDailyAnalytics,
  getReport,
  getReportSnapshot,
  getViolationWorkflowReport,
  listAccountants,
  listReportSnapshots,
  listViolations,
} from "@/lib/repo";
import { getWorkReport } from "@/lib/appeals-data";
import { reportSnapshotLabel } from "@/lib/report";
import { mondayOf } from "@/lib/scoring";
import { buildLiveViolationBreakdown } from "@/lib/violation-report";
import DashboardFilters from "@/components/DashboardFilters";
import ReportView from "@/components/ReportView";
import WeeklyScores from "@/components/WeeklyScores";
import SaveReportButton from "@/components/SaveReportButton";
import ExportPdfButton from "@/components/ExportPdfButton";
import AccountantViolationBreakdown from "@/components/AccountantViolationBreakdown";
import MargaritaSummary from "@/components/MargaritaSummary";
import EmployeeAuditSummary from "@/components/EmployeeAuditSummary";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ddmm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}` : iso;
}

function fmtSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    accountant?: string;
    client?: string;
    snapshot?: string;
    week?: string;
  };
}) {
  const filters = {
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  // Viewing a saved snapshot? Render its stored numbers read-only.
  const snapshot = searchParams.snapshot
    ? await getReportSnapshot(searchParams.snapshot)
    : null;

  const [accountants, history, analytics] = await Promise.all([
    listAccountants(),
    listReportSnapshots(),
    snapshot ? Promise.resolve(null) : getDailyAnalytics(filters),
  ]);
  const report = snapshot ? snapshot.report : analytics!.report;
  const previousReport = analytics?.previous ?? null;
  const periodLabel = snapshot ? snapshot.label : reportSnapshotLabel(filters);

  // Окно отчёта: явно выбранная дата побеждает; иначе — последний день с данными
  // (getDailyAnalytics.resolved). Оно же используется для нарушений/сводки, так
  // что «сегодня» показывает только сегодня, без смешивания прошлых дней.
  const win = snapshot
    ? { from: snapshot.filters.from, to: snapshot.filters.to }
    : analytics!.resolved;

  // Разбивка нарушений по бухгалтерам — ЖИВЫЕ данные (mqa_violations) за окно
  // отчёта. Только подтверждённые Маргаритой нарушения; правило warning/penalty
  // — единое (violations.ts). Никаких статических Excel-выгрузок и ИИ.
  const roster = accountants
    .filter((a) => a.active && a.role === "accountant")
    .map((a) => a.name);
  const liveViolations = snapshot
    ? []
    : await listViolations({
        from: win.from,
        to: win.to,
        accountant: filters.accountant,
      });
  const breakdown = buildLiveViolationBreakdown(liveViolations, roster);
  const perAccountant = breakdown.perAccountant;

  // Апелляции за окно (для сводки). Живут во внешних таблицах — если недоступны,
  // не роняем страницу, показываем нули.
  let appealSummary = { total: 0, pending: 0, approved: 0, rejected: 0 };
  if (!snapshot) {
    try {
      const wr = await getWorkReport({
        from: win.from,
        to: win.to,
        accountant: filters.accountant,
      });
      appealSummary = wr.appeals;
    } catch {
      /* внешние таблицы апелляций недоступны — оставляем нули */
    }
  }

  // Ключевые метрики рабочего цикла (нарушения → апелляции) за окно — та же
  // агрегация, что /work-report и Telegram (buildViolationWorkflowReport).
  const flow = snapshot
    ? null
    : await getViolationWorkflowReport({
        from: win.from,
        to: win.to,
        accountant: filters.accountant,
      });
  const flowTiles = flow
    ? [
        { label: "Подано апелляций", value: flow.appealsSubmitted },
        { label: "Ожидают решения", value: flow.appealsPending, alert: flow.appealsPending > 0 },
        { label: "Принято", value: flow.appealsApproved },
        { label: "Отклонено", value: flow.appealsRejected },
        { label: "Обработано апелляций", value: flow.appealsProcessed },
        { label: "Не обработано бухгалтерами", value: flow.unprocessedViolations, alert: flow.unprocessedViolations > 0 },
      ]
    : [];

  // История оценок за неделю (п.6): полная таблица «бухгалтер × день» за выбранную
  // неделю с навигацией по прошлым неделям. Тот же движок, что и недельный PDF.
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = mondayOf(searchParams.week || win.to || today);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  const weekEnd = weekDays[6];
  const weeklyReport = snapshot
    ? null
    : await getReport({
        accountant: filters.accountant,
        client: filters.client,
        from: weekStart,
        to: weekEnd,
      });
  const weekHref = (monday: string): string => {
    const p = new URLSearchParams();
    if (filters.accountant) p.set("accountant", filters.accountant);
    if (filters.client) p.set("client", filters.client);
    if (searchParams.from) p.set("from", searchParams.from);
    if (searchParams.to) p.set("to", searchParams.to);
    p.set("week", monday);
    return `/dashboard?${p.toString()}#weekly`;
  };
  const nextWeekStart = addDaysIso(weekStart, 7);
  const nextWeekHref =
    nextWeekStart <= mondayOf(today) ? weekHref(nextWeekStart) : null;

  return (
    <div className="space-y-4">
      <div className="no-print">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Отчёт</h1>
          {!snapshot && <AutoRefresh />}
        </div>
        <p className="text-sm text-gray-500">
          Ежедневный отчёт по качеству — по дате и бухгалтеру.
          {!snapshot && " Данные обновляются автоматически, без перезагрузки."}
        </p>
      </div>

      {snapshot ? (
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2 bg-amber-50 border-amber-200 no-print">
          <div className="text-sm">
            <span className="font-medium">Сохранённый отчёт:</span> {snapshot.label}
            <span className="text-gray-500">
              {" "}
              · сохранён {fmtSavedAt(snapshot.created_at)}
              {snapshot.created_by ? ` · ${snapshot.created_by}` : ""}
            </span>
          </div>
          <Link href="/dashboard" className="btn-secondary">
            ← К текущему отчёту
          </Link>
        </div>
      ) : (
        <div className="no-print">
          <DashboardFilters
            accountants={accountants.map((a) => a.name)}
            initial={filters}
          />
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 no-print">
        <ExportPdfButton />
        {!snapshot && <SaveReportButton filters={filters} />}
      </div>

      {/* Print-only heading so the exported PDF identifies the period. */}
      <div className="print-only mb-2">
        <h1 className="text-xl font-semibold">
          Отчёт по качеству — оценки по бухгалтерам
        </h1>
        <p className="text-sm">Период: {periodLabel}</p>
      </div>

      {/* Сводка Маргариты за период (только её подтверждённые данные). */}
      <MargaritaSummary
        data={{
          periodLabel,
          chatsChecked: report.totals.evaluatedChats,
          violations: breakdown.summary,
          appeals: appealSummary,
        }}
      />

      {/* Ключевые метрики рабочего цикла: апелляции и необработанные нарушения. */}
      {flow && (flowTiles.some((t) => t.value > 0)) && (
        <div className="no-print">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="font-semibold">Апелляции и ознакомления</h2>
            <Link href="/appeals" className="text-sm text-blue-600 hover:underline">
              → к апелляциям
            </Link>
            <Link href="/work-report" className="text-sm text-blue-600 hover:underline">
              → отчёт по работе
            </Link>
          </div>
          <div className="flex flex-wrap gap-3">
            {flowTiles.map((t) => (
              <div key={t.label} className={`card px-4 py-3 ${t.alert ? "ring-2 ring-amber-300" : ""}`}>
                <div className="text-2xl font-semibold">{t.value}</div>
                <div className="text-xs text-gray-500">{t.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ReportView report={report} previousReport={previousReport} />

      {/* История оценок за неделю (п.6) — полная таблица за текущую/прошлые недели. */}
      {weeklyReport && (
        <div id="weekly">
          <WeeklyScores
            report={weeklyReport}
            weekDays={weekDays}
            weekLabel={`${ddmm(weekStart)} – ${ddmm(weekEnd)}`}
            prevHref={weekHref(addDaysIso(weekStart, -7))}
            nextHref={nextWeekHref}
            today={today}
          />
        </div>
      )}

      {/* Нарушения по бухгалтерам — ЖИВЫЕ данные за выбранный период. */}
      <AccountantViolationBreakdown
        perAccountant={perAccountant}
        dateFrom={win.from ?? null}
        dateTo={win.to ?? null}
      />

      {/* Компактная сводка аудита сотрудников (вместо отдельной страницы). */}
      <EmployeeAuditSummary />

      {/* История отчётов — saved snapshots, newest first. */}
      <div className="card overflow-x-auto no-print">
        <div className="px-3 pt-3 text-sm font-medium">История отчётов</div>
        <table className="qa">
          <thead>
            <tr>
              <th>Период</th>
              <th>Сохранён</th>
              <th>Кем</th>
              <th>Активных</th>
              <th>Оценено</th>
              <th>Сервис %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-6">
                  Пока нет сохранённых отчётов. Нажмите «Сохранить в историю».
                </td>
              </tr>
            )}
            {history.map((s) => (
              <tr key={s.id} className={s.id === snapshot?.id ? "bg-amber-50" : ""}>
                <td className="font-medium">{s.label}</td>
                <td className="tabular-nums">{fmtSavedAt(s.created_at)}</td>
                <td className="text-gray-500">{s.created_by ?? "—"}</td>
                <td className="tabular-nums">{s.report.totals.activeChats}</td>
                <td className="tabular-nums">{s.report.totals.evaluatedChats}</td>
                <td className="tabular-nums">{s.report.serviceQualityPct}%</td>
                <td>
                  <Link
                    href={`/dashboard?snapshot=${s.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    Открыть →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail lives on its own pages — link instead of repeating it here. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 no-print">
        <Link href="/scoring" className="card p-3 hover:bg-gray-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">По чатам — статусы и качество</div>
            <div className="text-xs text-gray-500">оценки по каждому чату — на странице «Оценка»</div>
          </div>
          <span className="text-blue-600">→</span>
        </Link>
        <Link href="/messages" className="card p-3 hover:bg-gray-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Сообщение для Telegram (отчёт)</div>
            <div className="text-xs text-gray-500">текст и копирование — на странице «Сообщения»</div>
          </div>
          <span className="text-blue-600">→</span>
        </Link>
      </div>
    </div>
  );
}
