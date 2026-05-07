// tiny SVG sparkline · no deps. renders a smooth line + dot for the latest value.

export default function Sparkline({ data = [], width = 80, height = 24, color = '#01ecf3' }) {
  if (!data || data.length === 0) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }
  if (data.length === 1) {
    return (
      <svg width={width} height={height} aria-hidden="true">
        <circle cx={width - 4} cy={height / 2} r={3} fill={color} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (width - 8) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = 4 + i * stepX;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return [x, y];
  });

  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`))
    .join(' ');

  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

// bar chart variant for analytics page
export function SparkBars({ data = [], labels = [], width = 600, height = 200, color = '#01ecf3' }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-neutral-500 italic">[no data yet]</div>;
  }
  const max = Math.max(1, ...data);
  const padding = { top: 16, bottom: 32, left: 8, right: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barW = (chartW / data.length) * 0.6;
  const gap = (chartW / data.length) * 0.4;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {data.map((v, i) => {
        const h = (v / max) * chartH;
        const x = padding.left + i * (barW + gap) + gap / 2;
        const y = padding.top + (chartH - h);
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} fill={color} rx={2} />
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="10" fill="#444" fontWeight="600">
              {v}
            </text>
            {labels[i] && (
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize="9" fill="#999">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
