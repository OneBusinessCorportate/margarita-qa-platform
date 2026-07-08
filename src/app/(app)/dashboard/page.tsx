import Link from "next/link";
import {
  getDailyAnalytics,
  getReportSnapshot,
  listAccountants,
  listReportSnapshots,
} from "@/lib/repo";
import { reportSnapshotLabel } from "@/lib/report";
import DashboardFilters from "@/components/DashboardFilters";
import ReportView from "@/components/ReportView";
import SaveReportButton from "@/components/SaveReportButton";
import ExportPdfButton from "@/components/ExportPdfButton";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-xl font-semibold">Отчёт</h1>
        <p className="text-sm text-gray-500">
          Ежедневный отчёт по качеству — по дате и бухгалтеру.
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

      <ReportView report={report} previousReport={previousReport} />

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
        <Link href="/audit" className="card p-3 hover:bg-gray-50 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Аудит сотрудников</div>
            <div className="text-xs text-gray-500">
              только 14 действующих · нарушения, штрафы и бонусы из Excel · кто отсутствует
            </div>
          </div>
          <span className="text-blue-600">→</span>
        </Link>
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
