import test from "node:test";
import assert from "node:assert/strict";

import { resolveContextMeterMax, resolveContextMeterStats } from "./context-meter.ts";
import { extractModelId, lookupContextWindow } from "./context-window.ts";

test("context meter：跨会话时优先使用当前 session 持久化窗口", () => {
  const max = resolveContextMeterMax(
    {
      key: "session-a",
      model: "moonshot/moonshot-v1-8k",
      totalTokens: 4096,
      contextTokens: 8192,
    },
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
    { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k" },
  );

  assert.equal(max, 131_072);
});

test("context window：provider/model 复合键只取最后一段 model id", () => {
  assert.equal(
    extractModelId("openrouter/anthropic/claude-sonnet-4-6"),
    "claude-sonnet-4-6",
  );
  assert.equal(lookupContextWindow("openrouter/anthropic/claude-sonnet-4-6"), 200_000);
});

test("context meter：缺少 session 模型时不回退到全局 currentModel", () => {
  const max = resolveContextMeterMax(
    {
      key: "session-a",
      totalTokens: 4096,
    },
    null,
  );

  assert.equal(max, null);
});

test("context window：为主流 provider 提供保底窗口", () => {
  assert.equal(lookupContextWindow("openai/gpt-4o"), 128_000);
  assert.equal(lookupContextWindow("google/gemini-2.0-flash"), 1_000_000);
  assert.equal(lookupContextWindow("deepseek/deepseek-chat"), 64_000);
  assert.equal(lookupContextWindow("deepseek/deepseek-chat-128k"), 128_000);
  assert.equal(lookupContextWindow("qwen/qwen-plus"), 32_000);
  assert.equal(lookupContextWindow("qwen/qwen-long"), 256_000);
});

test("context meter：已知模型即使首条消息前 totalTokens 缺失也可显示 0%", () => {
  const stats = resolveContextMeterStats(
    {
      key: "session-a",
      model: "openai/gpt-4o",
    },
    null,
  );

  assert.deepEqual(stats, {
    used: 0,
    max: 128_000,
    ratio: 0,
    percent: 0,
    widthPct: "0.0",
  });
});
