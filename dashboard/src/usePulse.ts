import { useCallback, useEffect, useState } from 'react';
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { api } from './api';
import { minuteKey, toMinuteCounts, type MinuteCounts } from './time';
import type { Issue, PulseEvent } from './types';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';

const FEED_SIZE = 50;

/**
 * Everything the dashboard shows: issues by id, the live feed and per-minute counts.
 * History comes from the REST API once; everything after that is pushed over SignalR. No polling.
 */
export function usePulse() {
  const [issues, setIssues] = useState<Record<number, Issue>>({});
  const [feed, setFeed] = useState<PulseEvent[]>([]);
  const [perMinute, setPerMinute] = useState<MinuteCounts>({});
  const [connection, setConnection] = useState<Connection>('connecting');

  const upsertIssue = useCallback((issue: Issue) => {
    setIssues((all) => ({ ...all, [issue.id]: issue }));
  }, []);

  useEffect(() => {
    let stopped = false;
    const hub = new HubConnectionBuilder()
      .withUrl('/hubs/errors')
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => 2000 }) // keep trying forever
      .configureLogging(LogLevel.Warning)
      .build();

    hub.on('issueCreated', upsertIssue);
    hub.on('issueUpdated', upsertIssue);
    hub.on('eventReceived', (event: PulseEvent) => {
      setFeed((current) => [event, ...current].slice(0, FEED_SIZE));
      const minute = minuteKey(Date.now());
      setPerMinute((current) => ({ ...current, [minute]: (current[minute] ?? 0) + event.repeatCount }));
    });

    // Loaded after subscribing, so nothing that happens in between is missed. A push can still land
    // while this request is in flight, so keep whichever copy is newer instead of blindly overwriting.
    const loadSnapshot = async () => {
      const [issueList, recent, stats] = await Promise.all([api.issues(), api.recentEvents(FEED_SIZE), api.perMinute()]);
      if (stopped) return;
      setFeed((current) => {
        const byId = new Map([...recent, ...current].map((e) => [e.id, e]));
        return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, FEED_SIZE);
      });
      setIssues((current) => {
        const next = { ...current };
        for (const issue of issueList) {
          const live = current[issue.id];
          next[issue.id] = live && live.count > issue.count ? live : issue;
        }
        return next;
      });
      setPerMinute((current) => {
        const next = { ...current };
        for (const [minute, count] of Object.entries(toMinuteCounts(stats))) {
          next[Number(minute)] = Math.max(next[Number(minute)] ?? 0, count);
        }
        return next;
      });
    };

    hub.onreconnecting(() => setConnection('reconnecting'));
    hub.onreconnected(() => {
      setConnection('live');
      loadSnapshot().catch(() => {}); // catch up on anything pushed while we were away
    });

    // Started from a timer so React StrictMode's mount-unmount-mount in development cancels the first attempt
    // cleanly instead of aborting a half-finished negotiation.
    let startTimer = setTimeout(start, 0);
    function start() {
      hub
        .start()
        .then(() => {
          setConnection('live');
          loadSnapshot().catch(() => {});
        })
        .catch(() => {
          if (stopped) return;
          setConnection('offline');
          startTimer = setTimeout(start, 3000); // API not up yet: automatic reconnect only covers drops after a first connect
        });
    }

    return () => {
      stopped = true;
      clearTimeout(startTimer);
      hub.stop();
    };
  }, [upsertIssue]);

  return { issues, feed, perMinute, connection, upsertIssue };
}
