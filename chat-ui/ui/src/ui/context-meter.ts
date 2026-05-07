import { lookupContextWindow } from "./context-window.ts";
import type { GatewaySessionRow } from "./types.ts";

export type PendingContextModelOverride = {
  sessionKey: string;
  model: string;
};

function positiveTokenCount(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function sessionModel(session: GatewaySessionRow): string | null {
  return typeof session.model === "string" && session.model.trim() ? session.model : null;
}

function activePendingModel(
  session: GatewaySessionRow,
  override: PendingContextModelOverride | null | undefined,
): string | null {
  if (override?.sessionKey !== session.key) {
    return null;
  }
  return override.model.trim() ? override.model : null;
}

export function resolveContextMeterMax(
  session: GatewaySessionRow,
  currentModel: string | null | undefined,
  pendingOverride?: PendingContextModelOverride | null,
): number | null {
  const pendingModel = activePendingModel(session, pendingOverride);
  if (pendingModel) {
    // 同会话刚切模型时，旧 contextTokens 还没被 gateway 下一轮结果覆盖。
    return lookupContextWindow(pendingModel);
  }

  const sessionMax = positiveTokenCount(session.contextTokens);
  if (sessionMax) {
    return sessionMax;
  }

  return lookupContextWindow(sessionModel(session) ?? currentModel);
}
