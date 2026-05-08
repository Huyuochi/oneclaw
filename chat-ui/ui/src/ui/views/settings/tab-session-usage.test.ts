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
  windowStartDateLocal,
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
        usage: { input: 10, output: 20, cacheRead: 5 },
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

test("windowStartDateLocal returns the inclusive start of the requested day window", () => {
  // US DST spring-forward: Mar 8 plus the previous 89 days yields 90 inclusive days.
  assert.equal(windowStartDateLocal(new Date(2026, 2, 8, 3, 30)), "2025-12-09");
  // month-end: Jan 31 plus the previous 89 days
  assert.equal(windowStartDateLocal(new Date(2026, 0, 31, 23, 59)), "2025-11-03");
  // year-end: Dec 31 plus the previous 89 days
  assert.equal(windowStartDateLocal(new Date(2026, 11, 31, 23, 59)), "2026-10-03");
  // year-start: Jan 1 plus the previous 89 days
  assert.equal(windowStartDateLocal(new Date(2026, 0, 1, 0, 0)), "2025-10-04");
  // explicit days override
  assert.equal(windowStartDateLocal(new Date(2026, 5, 15, 12, 0), 30), "2026-05-17");
});

test("loadSessionUsageSnapshot keeps sessions.usage date-scoped without a row limit", async () => {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const visibleSessions = {
    sessions: [
      { key: "agent:a:s0" },
      { key: "agent:a:s2" },
      { key: "agent:a:s1" },
    ],
  };
  const usagePayload = {
    sessions: [
      { key: "agent:a:s0", sessionId: "s0", agentId: "a", updatedAt: 100, usage: { input: 1, output: 2, cacheRead: 3 } },
      { key: "agent:a:s1", sessionId: "s1", agentId: "a", updatedAt: 200, usage: { input: 10, output: 20, cacheRead: 30 } },
      { key: "agent:a:s2", sessionId: "s2", agentId: "a", updatedAt: 300, usage: { input: 100, output: 200, cacheRead: 300 } },
    ],
  };

  const now = new Date(2026, 2, 15, 12, 0);
  const result = await loadSessionUsageSnapshot(async <T>(method: string, params?: unknown): Promise<T> => {
    calls.push({ method, params });
    if (method === "sessions.list") return visibleSessions as T;
    if (method === "sessions.usage") return usagePayload as T;
    throw new Error(`unexpected method ${method}`);
  }, now);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    method: "sessions.list",
    params: { includeGlobal: true, includeUnknown: true, limit: FETCH_LIMIT },
  });
  assert.deepEqual(calls[1], {
    method: "sessions.usage",
    params: {
      startDate: windowStartDateLocal(now),
      endDate: todayDateStringLocal(now),
      mode: "gateway",
    },
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0]!.sessionId, "s2");
  assert.equal(result.rows[1]!.sessionId, "s1");
  assert.equal(result.rows[2]!.sessionId, "s0");
  assert.deepEqual(result.totals, { input: 111, output: 222, cacheRead: 333 });
});

test("loadSessionUsageSnapshot filters archived synthetic-key entries that leak from sessions.usage", async () => {
  const now = new Date(2026, 2, 15, 12, 0);
  const result = await loadSessionUsageSnapshot(async <T>(method: string): Promise<T> => {
    if (method === "sessions.list") {
      return {
        sessions: [{ key: "agent:a:s1" }],
      } as T;
    }
    if (method === "sessions.usage") {
      return {
        sessions: [
          { key: "agent:a:s1", sessionId: "s1", agentId: "a", updatedAt: 200, usage: { input: 10, output: 20, cacheRead: 30 } },
          // archived: present in sessions.usage but not in sessions.list
          { key: "agent:a:archived", sessionId: "archived", agentId: "a", updatedAt: 100, usage: { input: 99, output: 99, cacheRead: 99 } },
        ],
        totals: { input: 109, output: 119, cacheRead: 129 },
      } as T;
    }
    throw new Error(`unexpected method ${method}`);
  }, now);

  assert.deepEqual(result.rows.map((row) => row.sessionId), ["s1"]);
  // totals must come from the filtered rows, not the gateway response.totals (which includes archives)
  assert.deepEqual(result.totals, { input: 10, output: 20, cacheRead: 30 });
});

test("loadSessionUsageSnapshot returns empty result when sessions.list yields no visible keys", async () => {
  const now = new Date(2026, 2, 15, 12, 0);
  let usageCalled = false;
  const result = await loadSessionUsageSnapshot(async <T>(method: string): Promise<T> => {
    if (method === "sessions.list") return { sessions: [] } as T;
    if (method === "sessions.usage") {
      usageCalled = true;
      return { sessions: [] } as T;
    }
    throw new Error(`unexpected method ${method}`);
  }, now);

  assert.equal(usageCalled, false);
  assert.deepEqual(result, { rows: [], totalSessions: 0, totals: null });
});

test("loadSessionUsageSnapshot rethrows sessions.usage failures", async () => {
  const now = new Date(2026, 2, 15, 12, 0);
  await assert.rejects(
    loadSessionUsageSnapshot(async <T>(method: string): Promise<T> => {
      if (method === "sessions.list") {
        return { sessions: [{ key: "agent:a:s1" }] } as T;
      }
      if (method === "sessions.usage") {
        throw new Error("gateway timeout");
      }
      throw new Error(`unexpected method ${method}`);
    }, now),
    /gateway timeout/,
  );
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

// The KIMI/Moonshot cacheWrite estimation test was removed alongside the
// estimation logic — cacheWrite is no longer surfaced (see tab-session-usage.lib.ts).

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
