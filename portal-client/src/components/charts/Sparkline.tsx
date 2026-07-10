import { useId } from 'react';
import { ACCENTS } from '@/lib/accents';

/**
 * Ultra-light inline SVG sparkline. Used in the Analysis "Units Trend" column —
 * one per row, so a full Recharts instance per row would be far too heavy.
 * Pure SVG keeps hundreds of rows smooth.
 */
export function Sparkline({
  data,
  width = 84,
  height = 28,
  color,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const uid = useId();
  if (!data || data.length === 0) return <span className="text-slate-300">—</span>;
  if (data.length === 1) data = [data[0], data[0]];

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  // Higher value → smaller y (SVG y grows downward). Pad 2px top/bottom.
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`);
  const line = points.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const trendUp = data[data.length - 1] >= data[0];
  const stroke = color ?? (trendUp ? ACCENTS.emerald.solid : ACCENTS.rose.solid);
  // Unique per instance — a value-derived id collides across rows and cross-tints
  // the area-fill gradient (the polyline stroke is set directly, so it's fine).
  const gid = `spark-${uid.replace(/:/g, '')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
