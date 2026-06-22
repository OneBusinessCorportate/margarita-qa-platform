import ViolationsPanel from "@/components/ViolationsPanel";
import { getReport, listAccountants, listChats, listViolations } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ViolationsPage() {
  // Critical chats are the «Критично» chats from QA scoring. Surface the recent
  // window so they're always visible in Нарушения — not only after a manual
  // import. 30 days keeps the list actionable without dragging in old history.
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [accountants, chats, violations, report] = await Promise.all([
    listAccountants(),
    listChats(),
    listViolations(),
    getReport({ from, to }),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Нарушения</h1>
        <p className="text-sm text-gray-500">
          Журнал нарушений. Новая запись — в нижней строке.
        </p>
      </div>
      <ViolationsPanel
        accountants={accountants.map((a) => a.name)}
        chats={chats}
        initialViolations={violations.slice(0, 200)}
        criticalChats={report.criticalChats}
        criticalWindow={{ from, to }}
      />
    </div>
  );
}
