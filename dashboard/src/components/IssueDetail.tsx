import { useEffect, useState } from 'react';
import { api } from '../api';
import { clockTime, fullDate, timeAgo } from '../time';
import type { Issue, PulseEvent } from '../types';
import { IssueBadges, TypeChip, shortBrowser } from './bits';

interface Props {
  issue: Issue;
  now: number;
  onChange: (issue: Issue) => void;
  onClose: () => void;
}

export function IssueDetail({ issue, now, onChange, onClose }: Props) {
  const [events, setEvents] = useState<PulseEvent[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload the latest occurrences when the issue changes. Debounced, so an error storm triggers one request, not hundreds.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.events(issue.id).then((list) => !cancelled && setEvents(list)).catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [issue.id, issue.count]);

  const toggleStatus = async () => {
    setBusy(true);
    try {
      onChange(await api.setStatus(issue.id, issue.status === 'open' ? 'resolved' : 'open'));
    } finally {
      setBusy(false);
    }
  };

  const latest = events?.[0];

  return (
    <section className="card detail" aria-label="Issue detail">
      <div className="detail-head">
        <div className="detail-title">
          <div className="issue-line">
            <TypeChip type={issue.type} />
            <IssueBadges issue={issue} />
            <span className="muted">#{issue.id}</span>
          </div>
          <h2>{issue.title}</h2>
          <p className="muted">
            {issue.count.toLocaleString()} events · first seen <span title={fullDate(issue.firstSeen)}>{timeAgo(issue.firstSeen, now)}</span> · last
            seen <span title={fullDate(issue.lastSeen)}>{timeAgo(issue.lastSeen, now)}</span>
          </p>
        </div>
        <div className="detail-actions">
          <button className={issue.status === 'open' ? 'btn btn-primary' : 'btn'} onClick={toggleStatus} disabled={busy}>
            {issue.status === 'open' ? 'Resolve' : 'Reopen'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close detail">
            ✕
          </button>
        </div>
      </div>

      {!latest ? (
        <p className="empty">{events ? 'No stored events.' : 'Loading…'}</p>
      ) : (
        <>
          <h3>Latest occurrence</h3>
          <p className="latest-message">{latest.message}</p>
          <dl className="facts">
            <div><dt>When</dt><dd title={fullDate(latest.timestamp)}>{clockTime(latest.timestamp)}</dd></div>
            <div><dt>Release</dt><dd>{latest.release ?? '–'}</dd></div>
            <div><dt>Session</dt><dd>{latest.sessionId ?? '–'}</dd></div>
            <div><dt>Page</dt><dd>{latest.url ?? '–'}</dd></div>
            <div><dt>Browser</dt><dd title={latest.userAgent ?? ''}>{shortBrowser(latest.userAgent)}</dd></div>
          </dl>

          <div className="detail-columns">
            <div>
              <h3>Stack</h3>
              <pre className="code">{latest.stack || 'No stack captured.'}</pre>
            </div>
            <div>
              <h3>Context</h3>
              <pre className="code">{latest.context ? JSON.stringify(latest.context, null, 2) : 'None.'}</pre>
            </div>
          </div>

          <h3>Recent events</h3>
          <div className="table-scroll">
            <table className="events">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Message</th>
                  <th className="hide-narrow">Session</th>
                  <th className="num">Repeats</th>
                </tr>
              </thead>
              <tbody>
                {events!.map((e) => (
                  <tr key={e.id}>
                    <td className="muted nowrap">{clockTime(e.timestamp)}</td>
                    <td className="event-message">{e.message}</td>
                    <td className="hide-narrow muted">{e.sessionId ?? '–'}</td>
                    <td className="num">{e.repeatCount > 1 ? `×${e.repeatCount}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
