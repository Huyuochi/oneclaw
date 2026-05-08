/**
 * Pure logic for the Session Usage tab — split out so tests can import without
 * pulling in Lit decorators / DOM-side custom-element registrations.
 */

// Bound gateway reads so token aggregation never triggers an unbounded full-session scan.
export const FETCH_LIMIT = 500;

export interface SessionUsageRow {
  sessionId: string;
  isMain: boolean;
  customLabel: string | null;
  originLabel: string | null;
  updatedAt: number;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
}

interface MapResult {
  rows: SessionUsageRow[];
  totalSessions: number;
  totals: UsageTotals | null;
}

type GatewayRequest = <T = unknown>(method: string, params?: unknown) => Promise<T>;

function sumDisplayedTotals(rows: SessionUsageRow[]): UsageTotals | null {
  if (rows.length === 0) return null;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  for (const row of rows) {
    input += row.input ?? 0;
    output += row.output ?? 0;
    cacheRead += row.cacheRead ?? 0;
  }
  return { input, output, cacheRead };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export interface SessionUsageLoadFlags {
  initialized: boolean;
  loading: boolean;
}

export function beginSessionUsageLoad(
  state: SessionUsageLoadFlags,
  connected: boolean,
  hasClient: boolean,
): boolean {
  if (state.initialized || state.loading || !connected || !hasClient) return false;
  // Mark before awaiting so a failed request renders its error once, not once per render.
  state.initialized = true;
  state.loading = true;
  return true;
}

function pickToken(usage: unknown, key: "input" | "output" | "cacheRead"): number | null {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isMainSessionKey(sessionKey: string, agent: string): boolean {
  // A custom mainKey won't get the badge — covers the overwhelming majority of users.
  const lower = sessionKey.toLowerCase();
  return lower === `agent:${agent.toLowerCase()}:main` || lower === "main";
}

export function todayDateStringLocal(now: Date = new Date()): string {
  const y = now.getFullYear().toString().padStart(4, "0");
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatSessionUsageLimitNotice(template: string): string {
  return template.replace("{limit}", String(FETCH_LIMIT));
}

export function mapEntries(payload: unknown, activeKeys?: Set<string>): MapResult {
  if (!isRecord(payload)) return { rows: [], totalSessions: 0, totals: null };
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const rows: SessionUsageRow[] = [];
  for (const entry of sessions) {
    if (!isRecord(entry)) continue;
    const key = asString(entry.key) ?? "";
    if (activeKeys && !activeKeys.has(key)) continue;
    const sessionId = asString(entry.sessionId) ?? key;
    if (!sessionId) continue;
    const agent = asString(entry.agentId) ?? "";
    const origin = isRecord(entry.origin) ? entry.origin : null;
    rows.push({
      sessionId,
      isMain: isMainSessionKey(key, agent),
      customLabel: asString(entry.label),
      originLabel: origin ? asString(origin.label) : null,
      updatedAt: asNumber(entry.updatedAt),
      input: pickToken(entry.usage, "input"),
      output: pickToken(entry.usage, "output"),
      cacheRead: pickToken(entry.usage, "cacheRead"),
    });
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    rows,
    totalSessions: rows.length,
    totals: sumDisplayedTotals(rows),
  };
}

function activeSessionKeys(payload: unknown): Set<string> {
  const keys = new Set<string>();
  if (!isRecord(payload) || !Array.isArray(payload.sessions)) return keys;
  for (const session of payload.sessions) {
    if (!isRecord(session)) continue;
    const key = asString(session.key);
    if (key) keys.add(key);
  }
  return keys;
}

export async function loadSessionUsageSnapshot(
  request: GatewayRequest,
  now: Date = new Date(),
): Promise<MapResult> {
  const [payload, activeSessions] = await Promise.all([
    request("sessions.usage", {
      startDate: "1970-01-01",
      endDate: todayDateStringLocal(now),
      mode: "gateway",
      limit: FETCH_LIMIT,
    }),
    request("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
      limit: FETCH_LIMIT,
    }),
  ]);
  return mapEntries(payload, activeSessionKeys(activeSessions));
}
