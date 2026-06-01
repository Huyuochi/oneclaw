import type { ChatState } from "./controllers/chat.ts";
import type { UiSettings } from "./storage.ts";
import type { SessionsListResult } from "./types.ts";
import type { ConfiguredModel } from "./ui-types.ts";

export type SessionTransitionHost = ChatState & {
  chatQueue: unknown[];
  chatAvatarUrl: string | null;
  settings: UiSettings;
  currentModel: string | null;
  configuredModels: ConfiguredModel[];
  sessionsResult: SessionsListResult | null;
  applySettings(next: UiSettings): void;
  resetToolStream(): void;
  resetChatScroll(): void;
  loadAssistantIdentity(): Promise<void>;
};

// 切换到已有会话时，模型选择（及图片门控）应跟随该会话保存的模型：
// - 会话保存了仍然有效的模型 → 用它；
// - 会话未保存模型，或保存的模型已失效（不在已配置列表）→ 回退默认模型，与新建会话一致；
// - 会话行尚未加载（拿不到 model）→ 保持当前选择，避免无依据地清成默认。
export function resolveSessionModel(
  sessions: ReadonlyArray<{ key: string; model?: string }> | undefined,
  sessionKey: string,
  configuredModels: ConfiguredModel[] | undefined,
  currentModel: string | null,
): string | null {
  const row = sessions?.find((session) => session.key === sessionKey);
  if (!row) {
    return currentModel;
  }
  const models = configuredModels ?? [];
  if (row.model && models.some((model) => model.key === row.model)) {
    return row.model;
  }
  if (models.length === 0) {
    return currentModel;
  }
  return models.find((model) => model.isDefault)?.key ?? models[0]?.key ?? null;
}

export function syncCurrentModelFromActiveSession(
  host: Pick<SessionTransitionHost, "sessionKey" | "sessionsResult" | "configuredModels" | "currentModel">,
): boolean {
  const nextModel = resolveSessionModel(
    host.sessionsResult?.sessions,
    host.sessionKey,
    host.configuredModels,
    host.currentModel,
  );
  if (nextModel === host.currentModel) {
    return false;
  }
  host.currentModel = nextModel;
  return true;
}

// 提交已成功 patch 的模型变更，但只更新仍停留在同一会话上的 UI 状态。
export function commitResolvedSessionModelPatch(
  host: {
    sessionKey: string;
    currentModel: string | null;
  },
  patchedSessionKey: string,
  modelKey: string,
): boolean {
  if (host.sessionKey !== patchedSessionKey) {
    return false;
  }
  host.currentModel = modelKey;
  return true;
}

function syncUrlWithSessionKey(sessionKey: string, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionKey);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function applySessionKeyTransition(
  host: SessionTransitionHost,
  next: string,
  syncUrl = false,
): boolean {
  const trimmed = next.trim();
  if (!trimmed || trimmed === host.sessionKey) {
    return false;
  }
  host.sessionKey = trimmed;
  // 让模型选择跟随目标会话保存的模型，图片门控才能反映会话真实模型。
  syncCurrentModelFromActiveSession(host);
  host.chatMessage = "";
  host.chatAttachments = [];
  host.chatStream = null;
  host.chatPendingStreamText = null;
  host.chatStreamFrozenPrefix = "";
  host.chatVisibleMessageCount = 0;
  host.chatStreamStartedAt = null;
  host.chatRunId = null;
  host.chatQueue = [];
  host.chatAvatarUrl = null;
  host.resetToolStream();
  host.resetChatScroll();
  host.applySettings({
    ...host.settings,
    sessionKey: trimmed,
    lastActiveSessionKey: trimmed,
  });
  if (syncUrl) {
    syncUrlWithSessionKey(trimmed, true);
  }
  void host.loadAssistantIdentity();
  if (host.client && host.connected) {
    void import("./controllers/chat.ts").then(({ loadChatHistory }) => loadChatHistory(host as ChatState));
  }
  return true;
}
