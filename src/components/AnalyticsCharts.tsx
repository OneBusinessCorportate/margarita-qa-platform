"use client";

// Лёгкие inline-SVG/CSS графики для аналитического дашборда (без внешних
// библиотек — держим бандл и CSP чистыми). Каждый график: тонкие метки, прямые
// подписи значений (идентичность не только цветом), приглушённая сетка. Цвета —
// статусные бэнды качества (Отлично/Хорошо/Плохо/Критично), потому что оценка
// это и есть статус; объёмы (чаты/нарушения/апелляции) — по одному тону.

interface Bar {
  label: string;
  value: number;
  /** 0..100 для окраски по бэнду качества; если не задано — нейтральный тон. */
  score?: number;
  sub?: string;
  lowSample?: boolean;
}

/** Цвет по бэнду качества (совпадает со scoring.ts BANDS). */
function scoreColor(pct: number): string {
  if (pct >= 90) return "#16a34a";
  if (pct >= 80) return "#65a30d";
  if (pct >= 60) return "#d97706";
  return "#dc2626";
}

export function BarChart({
  title,
  subtitle,
  bars,
  color,
  unit = "",
  byScore = false,
  max,
}: {
  title: string;
  subtitle?: string;
  bars: Bar[];
  /** Фиксированный тон, когда окраска не по оценке. */
  color?: string;
  unit?: string;
  /** Красить каждый столбец по его оценке (bar.score). */
  byScore?: boolean;
  /** Явный максимум шкалы (иначе — максимум данных). */
  max?: number;
}) {
  const top = Math.max(max ?? 0, ...bars.map((b) => b.value), byScore ? 100 : 1);
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {subtitle && <div className="text-xs text-gray-400 mb-2">{subtitle}</div>}
      {bars.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">Нет данных за период.</div>
      ) : (
        <div className="space-y-1.5 mt-2">
          {bars.map((b) => {
            const pct = top > 0 ? Math.max((b.value / top) * 100, b.value > 0 ? 2 : 0) : 0;
            const fill = byScore && b.score != null ? scoreColor(b.score) : color ?? "#2563eb";
            return (
              <div key={b.label} className="flex items-center gap-2 text-xs">
                <div className="w-28 shrink-0 truncate text-gray-700" title={b.label}>
                  {b.label}
                </div>
                <div className="flex-1 bg-gray-100 rounded h-5 relative overflow-hidden">
                  <div
                    className="h-5 rounded transition-all"
                    style={{ width: `${pct}%`, backgroundColor: fill }}
                    title={`${b.label}: ${b.value}${unit}`}
                  />
                </div>
                <div className="w-20 shrink-0 text-right tabular-nums font-medium text-gray-800">
                  {b.value}
                  {unit}
                  {b.lowSample && (
                    <span className="ml-1 text-[10px] text-amber-500" title="мало проверенных чатов — оценка нерепрезентативна">
                      ⚠
                    </span>
                  )}
                  {b.sub && <span className="ml-1 text-[10px] text-gray-400">{b.sub}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Линия динамики средней оценки по отделу за период. */
export function TrendChart({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle?: string;
  /** Все дни периода по возрастанию; value=-1 означает «нет оценок» (разрыв). */
  points: { date: string; value: number }[];
}) {
  const W = 720;
  const H = 220;
  const padL = 34;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const withData = points.filter((p) => p.value >= 0);
  const n = points.length;
  const xFor = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v: number) => padT + plotH - (v / 100) * plotH;
  const ddmm = (iso: string) => {
    const [, m, d] = iso.slice(0, 10).split("-");
    return `${d}.${m}`;
  };

  // Строим путь по последовательным точкам с данными.
  const dataIdx = points
    .map((p, i) => ({ i, v: p.value }))
    .filter((p) => p.v >= 0);
  const path = dataIdx
    .map((p, k) => `${k === 0 ? "M" : "L"} ${xFor(p.i).toFixed(1)} ${yFor(p.v).toFixed(1)}`)
    .join(" ");

  // Подписи по оси X: не более ~10 меток, чтобы не слипались.
  const labelStep = Math.max(1, Math.ceil(n / 10));

  return (
    <div className="card p-4">
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {subtitle && <div className="text-xs text-gray-400 mb-1">{subtitle}</div>}
      {withData.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-400">Нет данных за период.</div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full min-w-[520px]"
            role="img"
            aria-label={title}
          >
            {/* Сетка + подписи Y на 60/80/90/100 */}
            {[60, 80, 90, 100].map((g) => (
              <g key={g}>
                <line
                  x1={padL}
                  y1={yFor(g)}
                  x2={W - padR}
                  y2={yFor(g)}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                />
                <text x={4} y={yFor(g) + 3} fontSize={9} fill="#9ca3af">
                  {g}
                </text>
              </g>
            ))}
            {/* Линия */}
            {withData.length > 1 && (
              <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
            )}
            {/* Точки */}
            {dataIdx.map((p) => (
              <g key={p.i}>
                <circle cx={xFor(p.i)} cy={yFor(p.v)} r={3.5} fill="#2563eb">
                  <title>{`${ddmm(points[p.i].date)}: ${p.v}%`}</title>
                </circle>
              </g>
            ))}
            {/* Подписи X */}
            {points.map((p, i) =>
              i % labelStep === 0 ? (
                <text
                  key={p.date}
                  x={xFor(i)}
                  y={H - 8}
                  fontSize={9}
                  fill="#9ca3af"
                  textAnchor="middle"
                >
                  {ddmm(p.date)}
                </text>
              ) : null
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
