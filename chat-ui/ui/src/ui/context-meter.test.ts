import test from "node:test";
import assert from "node:assert/strict";

import {
  attachRunIdToPendingOverride,
  resolveContextMeterMax,
  resolveContextMeterStats,
} from "./context-meter.ts";
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

test("context meter：给 pending override 绑定 runId 时保留原对象身份", () => {
  const override = { sessionKey: "session-a", model: "moonshot/moonshot-v1-128k", runId: null };

  const result = attachRunIdToPendingOverride(override, "session-a", "run-a");

  assert.equal(result, override);
  assert.equal(override.runId, "run-a");
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
  assert.equal(lookupContextWindow("deepseek/deepseek-chat"), 131_072);
  assert.equal(lookupContextWindow("deepseek/deepseek-chat-128k"), 128_000);
  assert.equal(lookupContextWindow("qwen/qwen-plus"), 131_072);
  assert.equal(lookupContextWindow("qwen/qwen-long"), 10_000_000);
});

test("context window：覆盖 2025-2026 DeepSeek 主流型号", () => {
  // V4 family — 1M
  assert.equal(lookupContextWindow("deepseek/deepseek-v4-pro"), 1_000_000);
  assert.equal(lookupContextWindow("deepseek/deepseek-v4-flash"), 1_000_000);
  // V3 / V3.1 / V3.2 — 128k
  assert.equal(lookupContextWindow("deepseek/deepseek-v3"), 131_072);
  assert.equal(lookupContextWindow("deepseek/deepseek-v3.1"), 131_072);
  assert.equal(lookupContextWindow("deepseek/deepseek-v3.1-terminus"), 131_072);
  assert.equal(lookupContextWindow("deepseek/deepseek-v3.2-exp"), 131_072);
  // R1 family — 128k(含 R1-0528)
  assert.equal(lookupContextWindow("deepseek/deepseek-r1"), 131_072);
  assert.equal(lookupContextWindow("deepseek/deepseek-r1-0528"), 131_072);
  // 当前 API 别名(迁移期映射到 V3.2)
  assert.equal(lookupContextWindow("deepseek/deepseek-reasoner"), 131_072);
  assert.equal(lookupContextWindow("deepseek/deepseek-coder"), 131_072);
});

test("context window：覆盖 2025-2026 Qwen 主流型号", () => {
  // 1M tier — Qwen3.5+/3.6 Plus 与 Flash
  assert.equal(lookupContextWindow("qwen/qwen3.6-plus"), 1_000_000);
  assert.equal(lookupContextWindow("qwen/qwen3.5-plus"), 1_000_000);
  assert.equal(lookupContextWindow("qwen/qwen3.6-flash"), 1_000_000);
  // 1M tier — Turbo(Qwen2.5-Turbo 起 1M)
  assert.equal(lookupContextWindow("qwen/qwen-turbo"), 1_000_000);
  assert.equal(lookupContextWindow("qwen/qwen-turbo-latest"), 1_000_000);
  assert.equal(lookupContextWindow("qwen/qwen2.5-turbo"), 1_000_000);
  // 256k tier — Qwen3-Max / Qwen3-Coder
  assert.equal(lookupContextWindow("qwen/qwen3-max"), 262_144);
  assert.equal(lookupContextWindow("qwen/qwen3-max-preview"), 262_144);
  assert.equal(lookupContextWindow("qwen/qwen3-coder"), 262_144);
  assert.equal(lookupContextWindow("qwen/qwen3-coder-plus"), 262_144);
  assert.equal(lookupContextWindow("qwen/qwen3-coder-next"), 262_144);
  // Qwen-Max 老快照仍是 32k
  assert.equal(lookupContextWindow("qwen/qwen-max"), 32_768);
});

test("context window：覆盖当前内置 OpenAI 与 Gemini 预设", () => {
  assert.equal(lookupContextWindow("openai/gpt-5.4"), 1_050_000);
  assert.equal(lookupContextWindow("openai/gpt-5.4-mini"), 400_000);
  assert.equal(lookupContextWindow("openai/gpt-5.2"), 400_000);
  assert.equal(lookupContextWindow("openai/gpt-5.2-codex"), 400_000);
  assert.equal(lookupContextWindow("google/gemini-3.1-pro-preview"), 1_000_000);
  assert.equal(lookupContextWindow("google/gemini-3.1-flash-lite-preview"), 1_000_000);
  assert.equal(lookupContextWindow("google/gemini-3-flash-preview"), 1_000_000);
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
