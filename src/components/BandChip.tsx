import { bandColor, bandFor, type QualityBand } from "@/lib/scoring";

export default function BandChip({
  total,
  band,
}: {
  total?: number;
  band?: QualityBand;
}) {
  const b = band ?? (typeof total === "number" ? bandFor(total) : "Критично");
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: bandColor(b) }}
    >
      {b}
    </span>
  );
}
