import test from "node:test";
import assert from "node:assert/strict";
import { setLocale, t } from "../../i18n.ts";
import {
  FETCH_LIMIT,
  beginSessionUsageLoad,
  formatSessionUsageLimitNotice,
  loadSessionUsageSnapshot,
  mapEntries,
  isRecord,
  todayDateStringLocal,
} from "./tab-session-usage.lib.ts";

test("session usage limit hint includes the active fetch limit", () => {
  assert.equal(
    formatSessionUsageLimitNotice("Shows up to the {limit} most recent sessions."),
    `Shows up to the ${FETCH_LIMIT} most recent sessions.`,
  );
});

test("session usage limit hint is localized", () => {
  setLocale("en");
  assert.match(t("settings.sessionUsage.limitHint"), /\{limit\}/);
  setLocale("zh");
  assert.match(t("settings.sessionUsage.limitHint"), /\{limit\}/);
  setLocale("en");
});

test("isRecord rejects arrays", () => {
  assert.equal(isRecord([]), false);
  assert.equal(isRecord([1, 2]), false);
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord("x"), false);
});

test("mapEntries returns empty result for non-record payload", () => {
  assert.deepEqual(mapEntries(null), { rows: [], totalSessions: 0, totals: null });
  assert.deepEqual(mapEntries([]), { rows: [], totalSessions: 0, totals: null });
  assert.deepEqual(mapEntries("nope"), { rows: [], totalSessions: 0, totals: null });
});

test("mapEntries uses key as the row id when sessionId is missing", () => {
  const payload = {
    sessions: [
      {
        sessionId: "s1",
        key: "agent:claude:s1",
        agentId: "claude",
        label: "Hello",
        updatedAt: 100,
        usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1 },
      },
      {
        key: "agent:claude:s3",
        agentId: "claude",
        updatedAt: 300,
        usage: { input: 3, output: 4, cacheRead: 5 },
      },
      // missing both sessionId and key
      { agentId: "claude", updatedAt: 400, usage: {} },
    ],
  };
  const result = mapEntries(payload);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]!.sessionId, "agent:claude:s3");
  assert.equal(result.rows[1]!.sessionId, "s1");
  assert.equal(result.rows[1]!.input, 10);
  assert.equal("cacheWrite" in result.rows[1]!, false);
  // Totals sum only the displayed rows' input/output/cacheRead — cacheWrite is excluded.
  assert.deepEqual(result.totals, { input: 13, output: 24, cacheRead: 10 });
  assert.equal(result.totalSessions, 2);
});

test("mapEntries returns null totals when no rows survive filtering", () => {
  assert.equal(mapEntries({ sessions: [] }).totals, null);
  assert.equal(mapEntries({}).totals, null);
});

test("mapEntries filters sessions missing from the active session key set", () => {
  const payload = {
    sessions: [
      {
        sessionId: "s1",
        key: "agent:claude:s1",
        agentId: "claude",
        updatedAt: 100,
        usage: { input: 1, output: 2, cacheRead: 3 },
      },
      {
        sessionId: "archived",
        key: "agent:claude:archived",
        agentId: "claude",
        updatedAt: 200,
        usage: { input: 10, output: 20, cacheRead: 30 },
      },
    ],
  };

  const result = mapEntries(payload, new Set(["agent:claude:s1"]));
  assert.deepEqual(result.rows.map((row) => row.sessionId), ["s1"]);
  assert.equal(result.totalSessions, 1);
  assert.deepEqual(result.totals, { input: 1, output: 2, cacheRead: 3 });
});

test("beginSessionUsageLoad keeps a failed load from retrying on every render", () => {
  const state = { initialized: false, loading: false };
  assert.equal(beginSessionUsageLoad(state, true, true), true);
  state.loading = false; // mirrors init().finally after a rejected request
  assert.equal(beginSessionUsageLoad(state, true, true), false);
});

test("loadSessionUsageSnapshot loads usage and active sessions before filtering client-side", async () => {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const sessions = [
    {
      key: "agent:a:archived",
      sessionId: "archived",
      updatedAt: 10_000,
      usage: { input: 1000, output: 1000, cacheRead: 1000 },
    },
    ...Array.from({ length: 205 }, (_, i) => ({
      key: `agent:a:s${i}`,
      sessionId: `s${i}`,
      updatedAt: 100 + i,
      usage: { input: 1, output: 2, cacheRead: 3 },
    })),
  ];

  const now = new Date("2025-12-02T00:00:00Z");
  const result = await loadSessionUsageSnapshot(async <T>(method: string, params?: unknown): Promise<T> => {
    calls.push({ method, params });
    if (method === "sessions.usage") return { sessions } as T;
    if (method === "sessions.list") {
      return {
        sessions: sessions.slice(1).map((session) => ({ key: session.key })),
      } as T;
    }
    throw new Error(`unexpected method ${method}`);
  }, now);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    method: "sessions.usage",
    params: {
      startDate: "1970-01-01",
      endDate: todayDateStringLocal(now),
      mode: "gateway",
      limit: FETCH_LIMIT,
    },
  });
  assert.deepEqual(calls[1], {
    method: "sessions.list",
    params: {
      includeGlobal: true,
      includeUnknown: true,
      limit: FETCH_LIMIT,
    },
  });
  assert.equal(result.rows.length, 205);
  assert.equal(result.rows[0]!.sessionId, "s204");
  assert.equal(result.rows[204]!.sessionId, "s0");
  assert.equal(
    result.rows.some((row) => row.sessionId === "archived"),
    false,
  );
  assert.deepEqual(result.totals, { input: 205, output: 410, cacheRead: 615 });
});

test("todayDateStringLocal formats local Y-M-D across DST, month-end, year-end", () => {
  assert.equal(todayDateStringLocal(new Date(2026, 2, 8, 3, 30)), "2026-03-08"); // US DST spring-forward
  assert.equal(todayDateStringLocal(new Date(2026, 0, 31, 23, 59)), "2026-01-31"); // month-end
  assert.equal(todayDateStringLocal(new Date(2026, 11, 31, 23, 59)), "2026-12-31"); // year-end
  assert.equal(todayDateStringLocal(new Date(2026, 0, 1, 0, 0)), "2026-01-01"); // year-start padding
});

test("mapEntries flags isMain for default agent main key", () => {
  const payload = {
    sessions: [
      { sessionId: "m", key: "agent:claude:main", agentId: "claude", updatedAt: 1, usage: {} },
      { sessionId: "x", key: "agent:claude:abc", agentId: "claude", updatedAt: 2, usage: {} },
    ],
  };
  const { rows } = mapEntries(payload);
  const main = rows.find((r) => r.sessionId === "m");
  const other = rows.find((r) => r.sessionId === "x");
  assert.ok(main?.isMain);
  assert.equal(other?.isMain, false);
});

test("mapEntries sorts rows by updatedAt desc without a display cap", () => {
  const sessions = Array.from({ length: 250 }, (_, i) => ({
    sessionId: `s${i}`,
    key: `agent:a:s${i}`,
    agentId: "a",
    updatedAt: i,
    usage: { input: 1, output: 2, cacheRead: 3 },
  }));
  const result = mapEntries({ sessions });
  assert.equal(result.rows.length, 250);
  assert.equal(result.totalSessions, 250);
  assert.deepEqual(result.totals, { input: 250, output: 500, cacheRead: 750 });
  assert.equal(result.rows[0]!.updatedAt, 249);
  assert.equal(result.rows[249]!.updatedAt, 0);
});
