import { useEffect, useState } from 'react';
import type { MinuteCount } from './types';

export const MINUTE = 60_000;
export const WINDOW_MINUTES = 30;

/** Minute buckets are keyed by the epoch millisecond their minute starts at. */
export type MinuteCounts = Record<number, number>;

export const minuteKey = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

export function toMinuteCounts(points: MinuteCount[]): MinuteCounts {
  const counts: MinuteCounts = {};
  for (const p of points) counts[minuteKey(Date.parse(p.minute))] = p.count;
  return counts;
}

/** The last 30 minutes as an array, oldest first, ending with the current minute. */
export function lastMinutes(counts: MinuteCounts, now: number): { minute: number; count: number }[] {
  const current = minuteKey(now);
  return Array.from({ length: WINDOW_MINUTES }, (_, i) => {
    const minute = current - (WINDOW_MINUTES - 1 - i) * MINUTE;
    return { minute, count: counts[minute] ?? 0 };
  });
}

/** Re-renders the caller every `intervalMs`, so relative times and charts keep moving without new data. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const clockTime = (iso: string | number) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fullDate = (iso: string) => new Date(iso).toLocaleString();
