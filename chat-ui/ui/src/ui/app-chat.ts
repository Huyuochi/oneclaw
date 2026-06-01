import type { OpenClawApp } from "./app.ts";
import type { GatewayHelloOk } from "./gateway.ts";
import type { ChatAttachment, ChatQueueItem, ConfiguredModel } from "./ui-types.ts";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { scheduleChatScroll } from "./app-scroll.ts";
import { setLastActiveSessionKey } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import {
  attachmentsBlockedByModel,
  attachmentLooksLikeImage,
} from "./chat/attachment-capability.ts";
import { abortChatRun, loadChatHistory, sendChatMessage } from "./controllers/chat.ts";
import { loadSessions, patchSession } from "./controllers/sessions.ts";
import { t } from "./i18n.ts";
import { normalizeBasePath } from "./navigation.ts";
import { pendingSessionLabels } from "./session-pending.ts";
import { generateUUID } from "./uuid.ts";

export type ChatHost = {
  connected: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatRunId: string | null;
  chatSending: boolean;
  sessionKey: string;
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  sessionsResult: { sessions: Array<{ key: string; label?: string }> } | null;
  // 真实宿主（OpenClawApp）始终提供这些字段；保持必填可避免门控因字段缺失而静默失效。
  configuredModels: ConfiguredModel[];
  currentModel: string | null;
  modelChangePendingSessionKey: string | null;
  lastError: string | null;
  waitForChatAttachmentPending?: () => Promise<void>;
  beginChatAttachmentSubmitCapture?: () => {
    attachments: ChatAttachment[];
    release: () => void;
  };
  isChatAttachmentSubmitCaptureActive?: () => boolean;
};


export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId);
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

// 仅统计真实用户输入消息：排除空输入和控制命令（如 stop/new/reset）。
export function isSharePromptCountableInput(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (isChatStopCommand(trimmed) || isChatResetCommand(trimmed)) {
    return false;
  }
  return true;
}

export async function handleAbortChat(host: ChatHost) {
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  await abortChatRun(host as unknown as OpenClawApp);
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
) {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
    },
  ];
}

// 判断当前模型是否不能发送给定附件中的图片（复用集中判定，避免与其它入口漂移）。
function hasUnsupportedImageAttachments(
  host: ChatHost,
  attachments: ChatAttachment[] | undefined,
): boolean {
  if (
    host.modelChangePendingSessionKey === host.sessionKey &&
    attachments?.some(attachmentLooksLikeImage)
  ) {
    return true;
  }
  return attachmentsBlockedByModel(attachments, host.configuredModels, host.currentModel);
}

// 统一设置图片不支持错误，供直接发送和队列发送复用。
// lastError 是响应式状态，赋值即触发 Lit 重渲染，无需显式 requestUpdate。
function reportUnsupportedImageAttachment(host: ChatHost): void {
  host.lastError = t("chat.imageUnsupported");
}

const SESSION_NAME_MAX_LEN = 20;

// 从消息文本提取 label（取第一行，截断到最大长度）
function deriveSessionLabel(message: string): string | null {
  const firstLine = message.split("\n")[0]?.trim() ?? "";
  if (!firstLine) {
    return null;
  }
  return firstLine.length > SESSION_NAME_MAX_LEN
    ? firstLine.slice(0, SESSION_NAME_MAX_LEN) + "…"
    : firstLine;
}

// 首条消息发送后，计算 label 并写入内存 + 加入待持久化队列
function syncSessionLabelAfterSend(host: ChatHost, message: string) {
  const key = host.sessionKey;

  // 判断是否需要自动命名：pending 队列中的新会话，或 gateway 返回的无 label 会话
  const sessions = host.sessionsResult?.sessions ?? [];
  const current = sessions.find((s) => s.key === key);
  const defaultLabel = t("chat.newSession");
  const needsAutoName =
    pendingSessionLabels.has(key) ||
    (current && (!current.label || current.label === defaultLabel));
  if (!needsAutoName) {
    return;
  }

  const label = deriveSessionLabel(message);
  if (!label) {
    return;
  }

  // 立即更新内存，侧边栏马上可见
  if (current) {
    current.label = label;
  }

  // 记入待持久化队列，等 chat.event final 后再 patch（避免被 agent runtime 覆盖）
  pendingSessionLabels.set(key, label);
}

// chat.event state="final" 后调用：agent runtime 已写完 sessions.json，此时 patch 不会被覆盖
export async function flushPendingSessionLabel(
  state: Parameters<typeof patchSession>[0],
  sessionKey: string,
) {
  const label = pendingSessionLabels.get(sessionKey);
  if (!label) {
    return;
  }
  pendingSessionLabels.delete(sessionKey);
  try {
    await patchSession(state, sessionKey, { label });
  } catch {
    // patch 失败则放回队列，下次 final 事件时重试
    pendingSessionLabels.set(sessionKey, label);
  }
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  const ok = Boolean(
    await sendChatMessage(host as unknown as OpenClawApp, message, opts?.attachments, (host as any).thinkingLevel),
  );
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    syncSessionLabelAfterSend(host, message);
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      host.sessionKey,
    );
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  if (ok && !host.chatRunId) {
    void flushChatQueue(host);
  }
  return ok;
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const [next, ...rest] = host.chatQueue;
  if (!next) {
    return;
  }
  if (hasUnsupportedImageAttachments(host, next.attachments)) {
    reportUnsupportedImageAttachment(host);
    return;
  }
  host.chatQueue = rest;
  const ok = await sendChatMessageNow(host, next.text, {
    attachments: next.attachments,
  });
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  }
}

export function removeQueuedMessage(host: ChatHost, id: string) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: { restoreDraft?: boolean },
) {
  if (!host.connected) {
    return false;
  }
  if (messageOverride == null && host.isChatAttachmentSubmitCaptureActive?.()) {
    // 上一次提交仍在收拢旧附件时，第二次 Enter 先忽略，避免覆盖 active capture。
    return false;
  }
  // 在按下 Enter 的瞬间快照提交上下文：目标会话与草稿文本。附件读取是异步的、必须 await，
  // 但 await 期间用户可能切换会话或继续输入。用快照定型这次提交，避免把后续草稿一并发出、
  // 或把这次 Enter 发到切换后的会话。
  const submittedSessionKey = host.sessionKey;
  const submittedDraft = host.chatMessage;
  if (messageOverride == null && isChatStopCommand(submittedDraft)) {
    await handleAbortChat(host);
    return false;
  }
  const attachmentCapture =
    messageOverride == null ? host.beginChatAttachmentSubmitCapture?.() ?? null : null;
  const restoreSubmittedComposerIfUntouched = () => {
    if (!attachmentCapture) {
      return;
    }
    // Composer state is global to the active chat view; only restore into the session
    // that owned this submit snapshot, never into a session selected while awaiting.
    if (host.sessionKey !== submittedSessionKey) {
      return;
    }
    if (host.chatMessage.length > 0 || (host.chatAttachments?.length ?? 0) > 0) {
      return;
    }
    host.chatMessage = submittedDraft;
    host.chatAttachments = attachmentCapture.attachments.map((att) => ({ ...att }));
  };
  if (messageOverride == null) {
    if (attachmentCapture) {
      // 提交快照接管旧附件后，立即释放 live composer，让用户输入下一条不会被 await 后的清理误伤。
      host.chatMessage = "";
      host.chatAttachments = [];
    }
    try {
      await host.waitForChatAttachmentPending?.();
    } finally {
      attachmentCapture?.release();
    }
    // 等待期间会话被切走：这次 Enter 的草稿/附件属于旧会话，绝不能误发到当前会话。
    // 不变量：这里到 sendChatMessage 实际读取 state.sessionKey 之间不能再有 await——
    // 该守卫只在“守卫之后到 live 读取之间同步执行”的前提下成立。若未来在此区间插入 await，
    // 需把会话快照透传给发送层，而非依赖此处的一次性比较。
    if (host.sessionKey !== submittedSessionKey) {
      return false;
    }
  }
  const previousDraft = submittedDraft;
  const message = (messageOverride ?? submittedDraft).trim();
  const attachments = attachmentCapture?.attachments ?? host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? attachments : [];
  const hasAttachments = attachmentsToSend.length > 0;

  // Allow sending with just attachments (no message text required)
  if (!message && !hasAttachments) {
    restoreSubmittedComposerIfUntouched();
    return false;
  }

  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return false;
  }

  // 发送前最后兜底：即使某个上传入口漏过，纯文本模型也不能带图片附件发出。
  if (hasUnsupportedImageAttachments(host, attachmentsToSend)) {
    reportUnsupportedImageAttachment(host);
    restoreSubmittedComposerIfUntouched();
    return false;
  }

  if (messageOverride == null && !attachmentCapture) {
    host.chatMessage = "";
    // Clear attachments when sending
    host.chatAttachments = [];
  }

  if (isChatBusy(host)) {
    enqueueChatMessage(host, message, attachmentsToSend);
    return true;
  }

  const ok = await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null && !attachmentCapture ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null && !attachmentCapture ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
  });
  if (!ok) {
    restoreSubmittedComposerIfUntouched();
  }
  return ok;
}

export async function refreshChat(host: ChatHost, opts?: { scheduleScroll?: boolean }) {
  await Promise.all([
    loadChatHistory(host as unknown as OpenClawApp),
    loadSessions(host as unknown as OpenClawApp),
    refreshChatAvatar(host),
  ]);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  }
}

export const flushChatQueueForEvent = flushChatQueue;

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}
