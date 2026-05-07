import test from "node:test";
import assert from "node:assert/strict";

import { resolveContextMeterMax } from "./context-meter.ts";

test("context meter：跨会话时优先使用当前 session 持久化窗口", () => {
  const max = resolveContextMeterMax(
    {
      key: "session-a",
      model: "moonshot/moonshot-v1-8k",
      totalTokens: 4096,
      contextTokens: 8192,
    },
    "moonshot/kimi-k2-0711-preview",
    { sessionKey: "session-b", model: "moonshot/kimi-k2-0711-preview" },
  );

  assert.equal(max, 8192);
});

test("context meter：同一会话刚切模型时用 pending 模型窗口保持即时反馈", () => {
  const max = resolveContextMeterMax(
    {
      key: "session-a",
      model: "moonshot/moonshot-v1-8k",
      totalTokens: 4096,
      contextTokens: 8192,
    },
    "moonshot/moonshot-v1-128k",
    { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k" },
  );

  assert.equal(max, 131_072);
});
