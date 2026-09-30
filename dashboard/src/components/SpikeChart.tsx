import { clockTime } from '../time';

interface Props {
  buckets: { minute: number; count: number }[];
}

// Round the y-axis up to a round number (6, 8, 10, 20, 25, 30, 40...) so the gridline labels stay readable.
function niceMax(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

/** Errors per minute for the last 30 minutes, current minute on the right. Plain divs, no chart library. */
export function SpikeChart({ buckets }: Props) {
  const max = niceMax(Math.max(0, ...buckets.map((b) => b.count)));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <section className="card chart">
      <div className="card-head">
        <div>
          <h2>Errors per minute</h2>
          <p className="muted">Last 30 minutes, including repeats the SDK folded together</p>
        </div>
        <p className="muted">{total.toLocaleString()} total</p>
      </div>

      <div className="plot" role="img" aria-label={`Errors per minute, last 30 minutes, peak ${Math.max(...buckets.map((b) => b.count))}`}>
        <div className="y-axis" aria-hidden="true">
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="bars">
          <div className="gridline" style={{ bottom: '100%' }} />
          <div className="gridline" style={{ bottom: '50%' }} />
          {buckets.map((b, i) => (
            <div
              key={b.minute}
              className={`bar${i === buckets.length - 1 ? ' bar-current' : ''}`}
              style={{ height: `${(b.count / max) * 100}%` }}
              title={`${clockTime(b.minute)} · ${b.count} error${b.count === 1 ? '' : 's'}`}
            />
          ))}
        </div>
      </div>
      <div className="x-axis" aria-hidden="true">
        <span>30 min ago</span>
        <span>15 min ago</span>
        <span>now</span>
      </div>
    </section>
  );
}
