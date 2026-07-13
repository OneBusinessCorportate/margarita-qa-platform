// Сводка работы Маргариты за выбранный период (только её подтверждённые данные).
import type { ViolationReportSummary } from "@/lib/violation-report";

const drams = (n: number) => `${n.toLocaleString("ru-RU")} др.`;

export interface MargaritaSummaryData {
  periodLabel: string;
  chatsChecked: number;
  violations: ViolationReportSummary;
  appeals: { total: number; pending: number; approved: number; rejected: number };
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "bad" | "good" | "info";
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
    <div className="rounded border border-gray-200 bg-white px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

export default function MargaritaSummary({ data }: { data: MargaritaSummaryData }) {
  const v = data.violations;
  return (
    <div className="card p-3 space-y-2">
      <div>
        <div className="text-sm font-semibold text-gray-700">
          Сводка Маргариты — {data.periodLabel}
        </div>
        <div className="text-xs text-gray-500">
          Только подтверждённые данные Маргариты (без ИИ). Предупреждение — 1-е
          нарушение за день; штраф — повторное за тот же день (1 000 др) или
          ручная санкция.
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <Stat label="Чатов проверено" value={data.chatsChecked} tone="info" />
        <Stat label="Нарушений" value={v.violations} />
        <Stat label="Предупреждений" value={v.warnings} tone="warn" />
        <Stat label="Штрафов" value={v.penalties} tone="bad" />
        <Stat label="Критичных" value={v.critical} tone="bad" />
        <Stat label="Сумма штрафов" value={drams(v.fineTotal)} tone="bad" />
        <Stat label="Апелляций" value={data.appeals.total} tone="info" />
        <Stat label="Апелляций одобрено" value={data.appeals.approved} tone="good" />
        <Stat label="Апелляций отклонено" value={data.appeals.rejected} />
        <Stat label="Апелляций ожидают" value={data.appeals.pending} tone="warn" />
      </div>
    </div>
  );
}
