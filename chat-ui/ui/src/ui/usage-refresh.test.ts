import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldClearContextOverrideAfterUsageRefresh,
  shouldClearOverrideAfterPatchError,
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
      { model: "moonshot/moonshot-v1-8k", contextTokens: 8192 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    false,
  );
});

test("usage refresh：usage 变化且 row 已是 pending 模型窗口后可以清理 override", () => {
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      { model: "moonshot/moonshot-v1-128k", contextTokens: 131_072 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    true,
  );
});

test("usage refresh：usage 变化但 row 仍是旧模型窗口时不能清理 pending override", () => {
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      { model: "moonshot/moonshot-v1-8k", contextTokens: 8192 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    false,
  );
});

test("usage refresh：baseline 缺失时，只有 row 已持久化 pending 模型窗口才清理 override", () => {
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
      { model: "moonshot/moonshot-v1-8k", contextTokens: 8192 },
      { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: "run-b" },
    ),
    false,
  );
  assert.equal(
    shouldClearContextOverrideAfterUsageRefresh(
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

test("model patch 失败：仅当当前 override 仍是本次发起的对象时才清理", () => {
  const ours = { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: null };
  const newer = { sessionKey: "session-a", model: "moonshot/moonshot-v1-32k", runId: null };
  // 已被后续切换覆盖（A 失败时 override 是 B），不能清掉 B
  assert.equal(shouldClearOverrideAfterPatchError(newer, ours), false);
  // 同内容但不同对象（A→B→A 二次切换在途），也不能清掉新发起的那一次
  const sameContent = { sessionKey: ours.sessionKey, model: ours.model, runId: null };
  assert.equal(shouldClearOverrideAfterPatchError(sameContent, ours), false);
  // 仍是自己，允许清理
  assert.equal(shouldClearOverrideAfterPatchError(ours, ours), true);
  // 已经为 null，无需再清
  assert.equal(shouldClearOverrideAfterPatchError(null, ours), false);
});

test("chat terminal refresh：final/error/aborted 都刷新 sessions", () => {
  assert.equal(shouldRefreshSessionsForChatState("final"), true);
  assert.equal(shouldRefreshSessionsForChatState("error"), true);
  assert.equal(shouldRefreshSessionsForChatState("aborted"), true);
  assert.equal(shouldRefreshSessionsForChatState("delta"), false);
  assert.equal(shouldRefreshSessionsForChatState(undefined), false);
});
