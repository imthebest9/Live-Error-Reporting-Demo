import type { Issue, IssueStatus, MinuteCount, PulseEvent } from './types';

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export const api = {
  issues: () => fetch('/api/issues').then(json<Issue[]>),

  recentEvents: (limit = 50) => fetch(`/api/events?limit=${limit}`).then(json<PulseEvent[]>),

  perMinute: () => fetch('/api/stats/per-minute').then(json<MinuteCount[]>),

  events: (issueId: number, limit = 20) =>
    fetch(`/api/issues/${issueId}/events?limit=${limit}`).then(json<PulseEvent[]>),

  setStatus: (issueId: number, status: IssueStatus) =>
    fetch(`/api/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(json<Issue>),
};
