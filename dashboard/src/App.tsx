import { useMemo, useState } from 'react';
import { IssueDetail } from './components/IssueDetail';
import { IssuesTable, type Filter } from './components/IssuesTable';
import { LiveFeed } from './components/LiveFeed';
import { SpikeChart } from './components/SpikeChart';
import { lastMinutes, useNow } from './time';
import { usePulse, type Connection } from './usePulse';

const GAME_URL = `${location.protocol}//${location.hostname}:8081/game/`;

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'API offline',
};

export default function App() {
  const { issues, feed, perMinute, connection, upsertIssue } = usePulse();
  const [filter, setFilter] = useState<Filter>('open');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const now = useNow(1000);

  const all = useMemo(
    () => Object.values(issues).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)),
    [issues],
  );
  const open = all.filter((i) => i.status === 'open');
  const visible = filter === 'all' ? all : filter === 'open' ? open : all.filter((i) => i.status === 'resolved');
  const counts = { open: open.length, resolved: all.length - open.length, all: all.length };
  const regressions = open.filter((i) => i.isRegression).length;

  const buckets = lastMinutes(perMinute, now);
  const thisMinute = buckets[buckets.length - 1].count;
  const last30 = buckets.reduce((sum, b) => sum + b.count, 0);
  const selected = selectedId === null ? undefined : issues[selectedId];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M2 12h4l3-8 4 16 3-8h6" />
          </svg>
          <div>
            <h1>Pulse</h1>
            <p>Live error reporting</p>
          </div>
        </div>
        <div className="topbar-right">
          <a href={GAME_URL} target="pulse-game" className="link">
            Open game ↗
          </a>
          <span className={`connection connection-${connection}`}>
            <span className="dot" />
            {CONNECTION_LABEL[connection]}
          </span>
        </div>
      </header>

      <section className="kpis">
        <Kpi label="Open issues" value={counts.open} />
        <Kpi label="Regressions" value={regressions} tone={regressions > 0 ? 'bad' : undefined} />
        <Kpi label="Errors, last 30 min" value={last30} />
        <Kpi label="This minute" value={thisMinute} tone={thisMinute > 0 ? 'hot' : undefined} />
      </section>

      <SpikeChart buckets={buckets} />

      <div className="layout">
        <main className="main-column">
          <IssuesTable
            issues={visible}
            counts={counts}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
            now={now}
          />
          {selected && (
            <IssueDetail
              key={selected.id}
              issue={selected}
              now={now}
              onChange={upsertIssue}
              onClose={() => setSelectedId(null)}
            />
          )}
        </main>
        <aside className="side-column">
          <LiveFeed events={feed} onSelect={setSelectedId} />
        </aside>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'hot' }) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value.toLocaleString()}</span>
    </div>
  );
}
