import assert from "node:assert/strict";
import { handleChatEvent, loadChatHistory } from "./chat.ts";

type RafTask = {
  id: number;
  fn: () => void;
};

class FakeRaf {
  private nextId = 1;
  private tasks = new Map<number, RafTask>();

  // 提供最小帧调度器，手动推进 requestAnimationFrame 回调。
  requestAnimationFrame(fn: FrameRequestCallback) {
    const id = this.nextId++;
    this.tasks.set(id, { id, fn: () => fn(performance.now()) });
    return id;
  }

  cancelAnimationFrame(id: number) {
    this.tasks.delete(id);
  }

  setTimeout(fn: () => void) {
    const id = this.nextId++;
    this.tasks.set(id, { id, fn });
    return id;
  }

  clearTimeout(id: number) {
    this.tasks.delete(id);
  }

  runNext() {
    const task = [...this.tasks.values()].sort((a, b) => a.id - b.id)[0];
    if (!task) {
      return;
    }
    this.tasks.delete(task.id);
    task.fn(performance.now());
  }

  runAll() {
    while (this.tasks.size > 0) {
      this.runNext();
    }
  }
}

function installBrowserGlobals(raf: FakeRaf) {
  Object.assign(globalThis, {
    window: {
      requestAnimationFrame: (fn: FrameRequestCallback) => raf.requestAnimationFrame(fn),
      cancelAnimationFrame: (id: number) => raf.cancelAnimationFrame(id),
      setTimeout: (fn: () => void) => raf.setTimeout(fn),
      clearTimeout: (id: number) => raf.clearTimeout(id),
    },
    requestAnimationFrame: (fn: FrameRequestCallback) => raf.requestAnimationFrame(fn),
    cancelAnimationFrame: (id: number) => raf.cancelAnimationFrame(id),
    setTimeout: (fn: () => void) => raf.setTimeout(fn),
    clearTimeout: (id: number) => raf.clearTimeout(id),
    performance: { now: () => 0 },
  });
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    client: null,
    connected: true,
    sessionKey: "session-1",
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    chatRunId: "run-1",
    chatStream: "",
    chatStreamStartedAt: null,
    chatVisibleMessageCount: 0,
    chatHistoryHydrationFrame: null,
    chatPendingStreamText: null,
    chatStreamFrame: null,
    chatStreamFrozenPrefix: "",
    lastError: null,
    ...overrides,
  } as any;
}

async function flushMicrotasks() {
  await Promise.resolve();
}

// stream delta 应在一帧内合并，只保留最新文本，避免每个 token 都触发重渲染。
async function testChatStreamIsRafThrottled() {
  const raf = new FakeRaf();
  installBrowserGlobals(raf);
  const state = makeState();

  handleChatEvent(state, {
    runId: "run-1",
    sessionKey: "session-1",
    state: "delta",
    message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
  });
  handleChatEvent(state, {
    runId: "run-1",
    sessionKey: "session-1",
    state: "delta",
    message: { role: "assistant", content: [{ type: "text", text: "hello world" }] },
  });

  assert.equal(state.chatStream, "", "delta 到达当帧不应立刻写入 Lit state");
  raf.runAll();
  assert.equal(state.chatStream, "hello world", "一帧内应只提交最新的 stream 文本");
}

// 首次加载大量历史消息时，首帧只渲染一个小批次，后续再渐进补齐。
async function testLoadChatHistoryBatchesInitialRender() {
  const raf = new FakeRaf();
  installBrowserGlobals(raf);
  const messages = Array.from({ length: 80 }, (_, index) => ({
    role: "assistant",
    content: [{ type: "text", text: `message-${index}` }],
    timestamp: index,
  }));
  const state = makeState({
    client: {
      request: async () => ({
        messages,
        thinkingLevel: "medium",
      }),
    },
  });

  await loadChatHistory(state);
  await flushMicrotasks();

  assert.equal(state.chatMessages.length, 80, "历史消息仍应完整保存在状态里");
  assert.equal(state.chatVisibleMessageCount, 20, "首帧应只暴露第一批可见消息");

  raf.runNext();
  assert.ok(state.chatVisibleMessageCount > 20, "后续帧应继续扩展可见消息");

  raf.runAll();
  assert.equal(state.chatVisibleMessageCount, 80, "渐进渲染结束后应补齐全部历史消息");
}

// 复现 #streaming-dup：工具事件之后的 delta 不应把已冻结前缀再次写入 chatStream。
// 之前的段已经被 app-tool-stream 冻成 leadingSegment 单独渲染，再写入就会和 leadingSegment 重复。
async function testDeltaAfterToolUseShowsOnlyTrailingText() {
  const raf = new FakeRaf();
  installBrowserGlobals(raf);
  const state = makeState();
  const prefix = "前置段：让我尝试直接调用 API";
  const trailing = "让我尝试使用一个已知的小红书 API 端点";

  // 1) tool_use 之前的流式：chatStream 反映完整文本。
  handleChatEvent(state, {
    runId: "run-1",
    sessionKey: "session-1",
    state: "delta",
    message: {
      role: "assistant",
      content: [{ type: "text", text: prefix }],
    },
  });
  raf.runAll();
  assert.equal(state.chatStream, prefix);

  // 2) 模拟 app-tool-stream 在 tool 事件中冻结 leadingSegment 后清空 chatStream。
  state.chatStreamFrozenPrefix = prefix;
  state.chatStream = null;
  state.chatPendingStreamText = null;

  // 3) tool 之后第一帧 delta：gateway 仍给累计文本，但 chatStream 只显示新段。
  handleChatEvent(state, {
    runId: "run-1",
    sessionKey: "session-1",
    state: "delta",
    message: {
      role: "assistant",
      content: prefix + trailing,
    },
  });
  raf.runAll();
  assert.equal(
    state.chatStream,
    trailing,
    "tool_use 之后的 chatStream 应只显示后续段，不应包含前置段",
  );
}

// 一个 turn 出现多次工具调用时，chatStream 始终只反映已冻结前缀之后那一段。
async function testDeltaWithMultipleToolUsesUsesLastTrailing() {
  const raf = new FakeRaf();
  installBrowserGlobals(raf);
  const state = makeState({
    chatStream: null,
    chatPendingStreamText: null,
    chatStreamFrozenPrefix: "firstsecond",
  });

  handleChatEvent(state, {
    runId: "run-1",
    sessionKey: "session-1",
    state: "delta",
    message: {
      role: "assistant",
      content: "firstsecondthird",
    },
  });
  raf.runAll();
  assert.equal(state.chatStream, "third", "应以最后一个 tool_use 之后的文本为流式当前段");
}

// 累计文本全部都已冻结时，chatStream 不应被任何旧文本污染。
async function testDeltaEndingWithToolUseLeavesStreamEmpty() {
  const raf = new FakeRaf();
  installBrowserGlobals(raf);
  const state = makeState({
    chatStream: null,
    chatPendingStreamText: null,
    chatStreamFrozenPrefix: "前置",
  });

  handleChatEvent(state, {
    runId: "run-1",
    sessionKey: "session-1",
    state: "delta",
    message: {
      role: "assistant",
      content: "前置",
    },
  });
  raf.runAll();
  assert.equal(state.chatStream, "", "尾部即 tool_use 时不应回写旧段");
}

async function main() {
  await testChatStreamIsRafThrottled();
  await testLoadChatHistoryBatchesInitialRender();
  await testDeltaAfterToolUseShowsOnlyTrailingText();
  await testDeltaWithMultipleToolUsesUsesLastTrailing();
  await testDeltaEndingWithToolUseLeavesStreamEmpty();
  console.log("chat controller tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
