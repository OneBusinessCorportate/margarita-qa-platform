import { getAnalytics, listAccountants } from "@/lib/repo";
import { buildPeriodSummaryMessage, telegramConfigured } from "@/lib/templates";
import DashboardFilters from "@/components/DashboardFilters";
import { BarChart, TrendChart } from "@/components/AnalyticsCharts";
import AnalyticsTable from "@/components/AnalyticsTable";
import DailyHistoryTable from "@/components/DailyHistoryTable";
import CopyButton from "@/components/CopyButton";
import SendTelegramButton from "@/components/SendTelegramButton";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y}` : iso;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from.slice(0, 10);
  const end = to.slice(0, 10);
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

function Card({
  value,
  label,
  tone = "default",
  hint,
}: {
  value: string | number;
  label: string;
  tone?: "default" | "good" | "bad" | "warn" | "info";
  hint?: string;
}) {
  const toneCls =
    tone === "bad"
      ? "text-red-700"
      : tone === "warn"
      ? "text-amber-700"
      : tone === "good"
      ? "text-green-700"
      : tone === "info"
      ? "text-blue-700"
      : "text-gray-900";
  return (
    <div className="card px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function Highlight({
  icon,
  title,
  name,
  value,
  tone,
}: {
  icon: string;
  title: string;
  name: string | null;
  value: string | null;
  tone: "good" | "bad" | "info" | "warn";
}) {
  const ring =
    tone === "good"
      ? "border-green-200 bg-green-50"
      : tone === "bad"
      ? "border-red-200 bg-red-50"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50"
      : "border-blue-200 bg-blue-50";
  return (
    <div className={`rounded-lg border px-4 py-3 ${ring}`}>
      <div className="text-xs text-gray-500 flex items-center gap-1">
        <span>{icon}</span>
        {title}
      </div>
      {name ? (
        <>
          <div className="text-base font-semibold text-gray-900 truncate" title={name}>
            {name}
          </div>
          {value && <div className="text-sm text-gray-600 tabular-nums">{value}</div>}
        </>
      ) : (
        <div className="text-sm text-gray-400 mt-1">нет данных</div>
      )}
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; accountant?: string; client?: string };
}) {
  // Аналитический дашборд по умолчанию открывается за ТЕКУЩИЙ МЕСЯЦ (запрос
  // руководства: «лучший бухгалтер месяца», «динамика за месяц»). Явно выбранный
  // в фильтре период всегда в приоритете и переопределяет это. Пресеты (день /
  // неделя / месяц / диапазон) переключают период в один клик.
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const noDates = !searchParams.from && !searchParams.to;
  const filters = {
    from: searchParams.from || (noDates ? monthStart : undefined),
    to: searchParams.to || (noDates ? today : undefined),
    accountant: searchParams.accountant || undefined,
    client: searchParams.client || undefined,
  };

  const [{ report, resolved }, accountants] = await Promise.all([
    getAnalytics(filters),
    listAccountants(),
  ]);

  const { totals, perAccountant, rankings } = report;
  const periodLabel =
    resolved.from === resolved.to
      ? fmtDay(resolved.from)
      : `${fmtDay(resolved.from)} — ${fmtDay(resolved.to)}`;
  const botReady = telegramConfigured();
  const summaryMessage = buildPeriodSummaryMessage(report);
  const hasData = totals.evaluations > 0 || totals.violations > 0 || totals.appeals > 0;

  // Полный список дней периода — чтобы линия динамики показывала разрывы дней
  // без оценок, а не «сжимала» их.
  const days = rangeDates(resolved.from, resolved.to);
  const perDayMap = new Map(report.perDay.map((d) => [d.date, d]));
  const trendPoints = days.map((d) => ({
    date: d,
    value: perDayMap.get(d)?.avgScore ?? -1,
  }));

  // Данные для графиков (реальные агрегаты).
  const scoreBars = perAccountant
    .filter((a) => a.avgScore >= 0)
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((a) => ({
      label: a.accountant,
      value: a.avgScore,
      score: a.avgScore,
      lowSample: a.lowSample,
      sub: `${a.chatsChecked} чат.`,
    }));
  const chatBars = perAccountant
    .filter((a) => a.chatsChecked > 0)
    .sort((a, b) => b.chatsChecked - a.chatsChecked)
    .map((a) => ({ label: a.accountant, value: a.chatsChecked }));
  const violationBars = perAccountant
    .filter((a) => a.violations > 0)
    .sort((a, b) => b.violations - a.violations)
    .map((a) => ({ label: a.accountant, value: a.violations, sub: a.appeals ? `${a.appeals} апелл.` : "" }));

  return (
    <div className="space-y-4">
      <div className="no-print">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Аналитика QA</h1>
          <AutoRefresh />
        </div>
        <p className="text-sm text-gray-500">
          Полная картина по бухгалтерам за период: оценки, объём проверок, нарушения и
          апелляции — сводные карточки, графики, рейтинги и суточная история. Все цифры из
          реальных записей и меняются вместе с выбранным периодом.
        </p>
      </div>

      <div className="no-print">
        <div className="text-sm font-medium mb-1">📅 Период</div>
        <DashboardFilters
          accountants={accountants.map((a) => a.name)}
          initial={filters}
          basePath="/analytics"
        />
      </div>

      {!hasData ? (
        <div className="card p-10 text-center">
          <div className="text-2xl mb-1">📭</div>
          <div className="text-sm font-medium text-gray-700">
            За период {periodLabel} данных нет
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Проверьте другой диапазон дат или бухгалтера, либо проведите QA в разделе «Оценка».
          </div>
        </div>
      ) : (
        <>
          {/* Сводные карточки */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Card value={periodLabel} label="Период" tone="info" />
            <Card value={totals.accountantsReviewed} label="Проверено бухгалтеров" tone="info" />
            <Card value={totals.chatsChecked} label="Проверено чатов" tone="info" />
            <Card
              value={totals.avgScore >= 0 ? `${totals.avgScore}%` : "—"}
              label="Средняя оценка"
              tone={totals.avgScore >= 80 ? "good" : totals.avgScore >= 60 ? "warn" : "bad"}
            />
            <Card value={totals.violations} label="Нарушений" tone={totals.violations ? "bad" : "default"} />
            <Card
              value={totals.appeals}
              label="Апелляций"
              tone="default"
              hint={
                totals.appeals
                  ? `✓ ${totals.appealsApproved} · ✕ ${totals.appealsRejected}${
                      totals.appealsPending ? ` · ожид. ${totals.appealsPending}` : ""
                    }`
                  : undefined
              }
            />
          </div>

          {/* Карточки-выводы */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Highlight
              icon="🏆"
              title="Лучший за период"
              name={rankings.topByScore?.accountant ?? null}
              value={rankings.topByScore ? `${rankings.topByScore.value}%` : null}
              tone="good"
            />
            <Highlight
              icon="🔻"
              title="Самая низкая средняя"
              name={rankings.bottomByScore?.accountant ?? null}
              value={rankings.bottomByScore ? `${rankings.bottomByScore.value}%` : null}
              tone="bad"
            />
            <Highlight
              icon="📊"
              title="Больше всех чатов"
              name={rankings.mostChats?.accountant ?? null}
              value={rankings.mostChats ? `${rankings.mostChats.value} чат.` : null}
              tone="info"
            />
            <Highlight
              icon="⚠️"
              title="Больше всех нарушений"
              name={rankings.mostViolations?.accountant ?? null}
              value={rankings.mostViolations ? `${rankings.mostViolations.value}` : null}
              tone="warn"
            />
          </div>

          {/* Динамика по отделу */}
          <TrendChart
            title="Динамика средней оценки по отделу"
            subtitle={`${periodLabel} · средняя оценка за каждый день`}
            points={trendPoints}
          />

          {/* Графики по бухгалтерам */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <BarChart
              title="Средняя оценка по бухгалтерам"
              subtitle="цвет — бэнд качества; ⚠ — мало чатов"
              bars={scoreBars}
              unit="%"
              byScore
              max={100}
            />
            <BarChart
              title="Проверено чатов по бухгалтерам"
              subtitle="объём проверенной работы"
              bars={chatBars}
              color="#2563eb"
            />
          </div>
          {violationBars.length > 0 && (
            <BarChart
              title="Нарушения по бухгалтерам"
              subtitle="подтверждённые нарушения за период"
              bars={violationBars}
              color="#e11d48"
            />
          )}

          {/* Краткий отчёт для Telegram */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">✈️ Краткий отчёт по QA за период (для Telegram)</div>
              <div className="flex gap-2">
                <CopyButton label="Копировать" className="btn-primary" text={summaryMessage} />
                <SendTelegramButton text={summaryMessage} configured={botReady} label="Отправить в Telegram" />
              </div>
            </div>
            <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded p-3 border border-gray-100">
{summaryMessage}
            </pre>
          </div>

          {/* Сортируемая сводка по бухгалтерам */}
          <AnalyticsTable rows={perAccountant} />

          {/* Суточная история */}
          <DailyHistoryTable rows={report.perDayPerAccountant} periodLabel={periodLabel} />
        </>
      )}
    </div>
  );
}
