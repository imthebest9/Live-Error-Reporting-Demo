// Mirrors the API's JSON contracts (api/Pulse.Api/Contracts.cs).

export type IssueStatus = 'open' | 'resolved';

export interface MinuteCount {
  minute: string;
  count: number;
}

export interface Issue {
  id: number;
  title: string;
  type: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  status: IssueStatus;
  isRegression: boolean;
  trend: MinuteCount[];
}

export interface PulseEvent {
  id: number;
  issueId: number;
  type: string;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
  release: string | null;
  sessionId: string | null;
  timestamp: string;
  context: Record<string, unknown> | null;
  repeatCount: number;
}
