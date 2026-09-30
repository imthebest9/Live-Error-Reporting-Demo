import { clockTime } from '../time';
import type { PulseEvent } from '../types';
import { TypeChip } from './bits';

interface Props {
  events: PulseEvent[];
  onSelect: (issueId: number) => void;
}

export function LiveFeed({ events, onSelect }: Props) {
  return (
    <section className="card feed">
      <div className="card-head">
        <div>
          <h2>Live feed</h2>
          <p className="muted">Newest first, last 50 events</p>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="empty">Waiting for errors…</p>
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <button className="feed-item" onClick={() => onSelect(event.issueId)}>
                <span className="feed-top">
                  <TypeChip type={event.type} />
                  {event.repeatCount > 1 && (
                    <span className="repeat" title="Duplicates the SDK folded into this one event">
                      ×{event.repeatCount}
                    </span>
                  )}
                  <time dateTime={event.timestamp}>{clockTime(event.timestamp)}</time>
                </span>
                <span className="feed-message">{event.message || '(no message)'}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
