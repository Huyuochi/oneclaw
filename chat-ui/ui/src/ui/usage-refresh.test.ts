import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldClearContextOverrideAfterUsageRefresh,
  shouldClearPendingContextModelOverride,
  shouldFinishUsageRefreshAttempt,
  shouldRefreshSessionsForChatState,
} from "./usage-refresh.ts";

test("usage refresh：baseline 缺失时不因第一条旧 row 提前结束轮询", () => {
  assert.equal(shouldFinishUsageRefreshAttempt(null, "100:8192", false), false);
});

test("usage refresh：baseline 缺失时跑完所有轮询后可以结束", () => {
  assert.equal(shouldFinishUsageRefreshAttempt(null, "100:8192", true), true);
});

test("usage refresh：baseline 存在时拿到变化的 usage 即可结束", () => {
  assert.equal(shouldFinishUsageRefreshAttempt("100:8192", "200:131072", false), true);
});

test("usage refresh：baseline 存在但 usage 未变化时最后一轮也要兜底结束", () => {
  assert.equal(shouldFinishUsageRefreshAttempt("100:8192", "100:8192", true), true);
});

test("usage refresh：baseline 存在但当前 row 消失时继续等待", () => {
  assert.equal(shouldFinishUsageRefreshAttempt("100:8192", null, false), false);
});

test("usage refresh：baseline 存在但 row 消失时最后一轮也要兜底结束", () => {
  assert.equal(shouldFinishUsageRefreshAttempt("100:8192", null, true), true);
});

test("usage refresh：最后一轮若 usage 未变化，不能清理 pending override", () => {
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      "100:8192",
      "100:8192",
      { model: "moonshot/moonshot-v1-8k", contextTokens: 8192 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    false,
  );
});

test("usage refresh：拿到变化的 usage 后可以清理 pending override", () => {
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      "100:8192",
      "200:131072",
      { model: "moonshot/moonshot-v1-128k", contextTokens: 131_072 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    true,
  );
});

test("usage refresh：baseline 缺失时，只有 row 已持久化 pending 模型窗口才清理 override", () => {
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      null,
      "100:8192",
      { model: "moonshot/moonshot-v1-8k", contextTokens: 8192 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    false,
  );
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      null,
      "100:131072",
      { model: "moonshot/moonshot-v1-128k", contextTokens: 131_072 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    true,
  );
});

test("usage refresh：旧 run 的终态不能清理之后切换出的 pending override", () => {
  assert.equal(
    shouldClearPendingContextModelOverride(
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: null },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-a" },
      true,
    ),
    false,
  );
  assert.equal(
    shouldClearPendingContextModelOverride(
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-a" },
      true,
    ),
    false,
  );
  assert.equal(
    shouldClearPendingContextModelOverride(
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
      true,
    ),
    true,
  );
});

test("chat terminal refresh：final/error/aborted 都刷新 sessions", () => {
  assert.equal(shouldRefreshSessionsForChatState("final"), true);
  assert.equal(shouldRefreshSessionsForChatState("error"), true);
  assert.equal(shouldRefreshSessionsForChatState("aborted"), true);
  assert.equal(shouldRefreshSessionsForChatState("delta"), false);
  assert.equal(shouldRefreshSessionsForChatState(undefined), false);
});
