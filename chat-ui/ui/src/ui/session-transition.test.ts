import assert from "node:assert/strict";
import { applySessionKeyTransition, commitResolvedSessionModelPatch } from "./session-transition.ts";

function makeHost() {
  let assistantLoads = 0;
  let toolResets = 0;
  let scrollResets = 0;
  let thinkingUpdates = 0;
  const host = {
    client: null,
    connected: false,
    sessionKey: "session-a",
    currentModel: "provider/model-a",
    configuredModels: [
      {
        key: "provider/model-a",
        name: "Model A",
        provider: "provider",
        isDefault: false,
        supportsImage: false,
      },
      {
        key: "provider/model-b",
        name: "Model B",
        provider: "provider",
        isDefault: true,
        supportsImage: true,
      },
    ],
    settings: {
      sessionKey: "session-a",
      lastActiveSessionKey: "session-a",
    },
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatMessage: "draft",
    chatAttachments: [{ name: "file.txt" }],
    chatRunId: "run-1",
    chatStream: "stream",
    chatStreamStartedAt: 123,
    chatHistoryHydrationFrame: null,
    chatPendingStreamText: "pending",
    chatStreamFrame: null,
    chatVisibleMessageCount: 7,
    chatQueue: [{ id: "queued" }],
    chatAvatarUrl: "https://example.com/avatar.png",
    basePath: "",
    hello: null,
    sessionsResult: {
      sessions: [
        { key: "session-a", model: "provider/model-a" },
        { key: "session-b", model: "provider/model-b" },
      ],
    },
    lastError: null,
    applySettings(next: Record<string, unknown>) {
      this.settings = next as any;
    },
    resetToolStream() {
      toolResets++;
    },
    resetChatScroll() {
      scrollResets++;
    },
    updateThinkingCapabilities() {
      thinkingUpdates++;
    },
    async loadAssistantIdentity() {
      assistantLoads++;
    },
  } as any;
  return {
    host,
    get assistantLoads() {
      return assistantLoads;
    },
    get toolResets() {
      return toolResets;
    },
    get scrollResets() {
      return scrollResets;
    },
    get thinkingUpdates() {
      return thinkingUpdates;
    },
  };
}

async function testApplySessionKeyTransitionResetsComposerState() {
  const ctx = makeHost();

  const changed = applySessionKeyTransition(ctx.host, "session-b");
  await Promise.resolve();

  assert.equal(changed, true);
  assert.equal(ctx.host.sessionKey, "session-b");
  assert.equal(ctx.host.currentModel, "provider/model-b");
  assert.equal(ctx.host.chatMessage, "");
  assert.deepEqual(ctx.host.chatAttachments, []);
  assert.equal(ctx.host.chatStream, null);
  assert.equal(ctx.host.chatPendingStreamText, null);
  assert.equal(ctx.host.chatVisibleMessageCount, 0);
  assert.equal(ctx.host.chatStreamStartedAt, null);
  assert.equal(ctx.host.chatRunId, null);
  assert.deepEqual(ctx.host.chatQueue, []);
  assert.equal(ctx.host.chatAvatarUrl, null);
  assert.equal(ctx.host.settings.sessionKey, "session-b");
  assert.equal(ctx.host.settings.lastActiveSessionKey, "session-b");
  assert.equal(ctx.assistantLoads, 1);
  assert.equal(ctx.toolResets, 1);
  assert.equal(ctx.scrollResets, 1);
  assert.equal(ctx.thinkingUpdates, 0);
}

function testCommitResolvedSessionModelPatchDoesNotRefreshThinkingCapabilities() {
  let thinkingUpdates = 0;
  const host = {
    sessionKey: "session-a",
    currentModel: "provider/model-a",
    updateThinkingCapabilities() {
      thinkingUpdates++;
    },
  };

  const changed = commitResolvedSessionModelPatch(host, "session-a", "provider/model-b");

  assert.equal(changed, true);
  assert.equal(host.currentModel, "provider/model-b");
  assert.equal(thinkingUpdates, 0);
}

async function main() {
  await testApplySessionKeyTransitionResetsComposerState();
  testCommitResolvedSessionModelPatchDoesNotRefreshThinkingCapabilities();
  console.log("session transition tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
