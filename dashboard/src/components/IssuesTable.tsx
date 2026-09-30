import { fullDate, lastMinutes, timeAgo, toMinuteCounts } from '../time';
import type { Issue } from '../types';
import { IssueBadges, Sparkline, TypeChip } from './bits';

export type Filter = 'open' | 'resolved' | 'all';

interface Props {
  issues: Issue[];
  counts: Record<Filter, number>;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  now: number;
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export function IssuesTable({ issues, counts, filter, onFilter, selectedId, onSelect, now }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Issues</h2>
          <p className="muted">One row per bug, grouped by fingerprint</p>
        </div>
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              className={filter === f.value ? 'tab tab-active' : 'tab'}
              onClick={() => onFilter(f.value)}
            >
              {f.label} <span className="tab-count">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {issues.length === 0 ? (
        <p className="empty">
          {filter === 'resolved' ? 'Nothing resolved yet.' : 'No issues yet. Break something in the game and watch it land here.'}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="issues">
            <thead>
              <tr>
                <th>Issue</th>
                <th className="num">Events</th>
                <th className="hide-narrow">Last 30 min</th>
                <th className="hide-medium">First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => {
                const fresh = now - Date.parse(issue.lastSeen) < 3000;
                const classes = [issue.id === selectedId && 'selected', fresh && 'fresh'].filter(Boolean).join(' ');
                return (
                  // Keyed by count too, so an update remounts the row and replays the highlight animation.
                  <tr
                    key={`${issue.id}-${issue.count}-${issue.status}`}
                    className={classes}
                    onClick={() => onSelect(issue.id)}
                    onKeyDown={(e) => e.key === 'Enter' && onSelect(issue.id)}
                    tabIndex={0}
                  >
                    <td className="issue-cell">
                      <div className="issue-line">
                        <TypeChip type={issue.type} />
                        <IssueBadges issue={issue} />
                      </div>
                      <div className="issue-title" title={issue.title}>{issue.title}</div>
                    </td>
                    <td className="num count">{issue.count.toLocaleString()}</td>
                    <td className="hide-narrow">
                      <Sparkline values={lastMinutes(toMinuteCounts(issue.trend), now).map((b) => b.count)} />
                    </td>
                    <td className="hide-medium muted" title={fullDate(issue.firstSeen)}>{timeAgo(issue.firstSeen, now)}</td>
                    <td className="muted" title={fullDate(issue.lastSeen)}>{timeAgo(issue.lastSeen, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
