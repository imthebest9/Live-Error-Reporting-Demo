import type { Issue } from '../types';

const TYPE_COLORS: Record<string, string> = {
  TypeError: 'amber',
  RangeError: 'violet',
  FetchError: 'sky',
  UnhandledRejection: 'pink',
  Error: 'red',
};

export function TypeChip({ type }: { type: string }) {
  return <span className={`chip chip-${TYPE_COLORS[type] ?? 'gray'}`}>{type}</span>;
}

export function IssueBadges({ issue }: { issue: Issue }) {
  return (
    <>
      {issue.isRegression && issue.status === 'open' && <span className="badge badge-regression">Regression</span>}
      {issue.status === 'resolved' && <span className="badge badge-resolved">Resolved</span>}
    </>
  );
}

/** Tiny bar chart of an issue's last 30 minutes. */
export function Sparkline({ values }: { values: number[] }) {
  const width = 90;
  const height = 22;
  const max = Math.max(1, ...values);
  const slot = width / values.length;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} />
      {values.map((value, i) => {
        if (value === 0) return null;
        const h = Math.max(2, (value / max) * height);
        return <rect key={i} x={i * slot + 0.4} y={height - h} width={slot - 0.8} height={h} rx="0.6" />;
      })}
    </svg>
  );
}

export function shortBrowser(userAgent: string | null): string {
  if (!userAgent) return 'unknown';
  const match = userAgent.match(/(Firefox|Edg|Chrome|Safari|curl)\/(\d+)/);
  if (!match) return userAgent.slice(0, 40);
  const name = match[1] === 'Edg' ? 'Edge' : match[1];
  return `${name} ${match[2]}`;
}
