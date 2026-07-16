import { listAccountants } from "@/lib/repo";
import { SCHEMES } from "@/lib/scoring";
import ConfidenceReportView from "@/components/ConfidenceReport";

export const dynamic = "force-dynamic";

export default async function ConfidencePage() {
  const accountants = await listAccountants();
  const names = accountants
    .filter((a) => a.active)
    .map((a) => a.name)
    .sort((x, y) => x.localeCompare(y, "ru"));
  const categories = SCHEMES.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="p-4 sm:p-6">
      <ConfidenceReportView accountants={names} categories={categories} />
    </div>
  );
}
