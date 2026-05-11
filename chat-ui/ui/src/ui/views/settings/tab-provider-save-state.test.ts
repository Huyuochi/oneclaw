import test from "node:test";
import assert from "node:assert/strict";

import { resolveAddedModelKey } from "./tab-provider-save-state.ts";

test("resolveAddedModelKey prefers the modelKey returned by save-provider", () => {
  const previous = new Set(["kimi-coding/kimi-k2"]);
  const models = [
    { key: "kimi-coding/kimi-k2", name: "kimi-k2", provider: "kimi-coding", isDefault: true },
    { key: "kimi-coding/kimi-k3", name: "kimi-k3", provider: "kimi-coding", isDefault: false },
  ];

  assert.equal(resolveAddedModelKey({ modelKey: "kimi-coding/kimi-k3" }, previous, models), "kimi-coding/kimi-k3");
});

test("resolveAddedModelKey falls back to the first newly configured model", () => {
  const previous = new Set(["kimi-coding/kimi-k2"]);
  const models = [
    { key: "kimi-coding/kimi-k2", name: "kimi-k2", provider: "kimi-coding", isDefault: true },
    { key: "kimi-coding/kimi-k3", name: "kimi-k3", provider: "kimi-coding", isDefault: false },
  ];

  assert.equal(resolveAddedModelKey(undefined, previous, models), "kimi-coding/kimi-k3");
});

test("resolveAddedModelKey returns null when no new model can be identified", () => {
  const previous = new Set(["kimi-coding/kimi-k2"]);
  const models = [
    { key: "kimi-coding/kimi-k2", name: "kimi-k2", provider: "kimi-coding", isDefault: true },
  ];

  assert.equal(resolveAddedModelKey({ success: true }, previous, models), null);
});
