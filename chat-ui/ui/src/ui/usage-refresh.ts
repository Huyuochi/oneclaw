import { lookupContextWindow } from "./context-window.ts";
import type { PendingContextModelOverride } from "./context-meter.ts";

export type UsageSnapshot = string | null;

type UsageRowForRefresh = {
  model?: unknown;
  contextTokens?: unknown;
} | null;

type PendingContextModelClearTarget = {
  sessionKey: string;
  model: string;
  runId: string | null;
};

export function shouldRefreshSessionsForChatState(state: string | null | undefined): boolean {
  return state === "final" || state === "error" || state === "aborted";
}

export function shouldFinishUsageRefreshAttempt(
  baseline: UsageSnapshot,
  current: UsageSnapshot,
  isLastAttempt: boolean,
): boolean {
  if (isLastAttempt) {
    return true;
  }
  if (current === null || baseline === null) {
    return false;
  }
  return didUsageSnapshotChange(baseline, current);
}

function didUsageSnapshotChange(baseline: UsageSnapshot, current: UsageSnapshot): boolean {
  return baseline !== null && current !== null && current !== baseline;
}

function rowModel(row: UsageRowForRefresh): string | null {
  const model = row?.model;
  return typeof model === "string" && model.trim() ? model : null;
}

function rowContextTokens(row: UsageRowForRefresh): number | null {
  const contextTokens = row?.contextTokens;
  return typeof contextTokens === "number" && contextTokens > 0 ? contextTokens : null;
}

function isPendingModelPersisted(
  row: UsageRowForRefresh,
  pending: PendingContextModelOverride | null | undefined,
): boolean {
  if (!pending || rowModel(row) !== pending.model) {
    return false;
  }
  const contextTokens = rowContextTokens(row);
  if (contextTokens === null) {
    return false;
  }
  const expectedContextTokens = lookupContextWindow(pending.model);
  return expectedContextTokens === null || contextTokens === expectedContextTokens;
}

export function shouldClearContextOverrideAfterUsageRefresh(
  row: UsageRowForRefresh,
  pending: PendingContextModelOverride | null | undefined,
): boolean {
  return isPendingModelPersisted(row, pending);
}

// 模型切换 patch 失败时调用：仅当当前 override 仍是本次切换发起的那个对象时才清掉，
// 避免连切 A→B 时 A 的失败 catch 把 B 刚 set 的 override 也清空。
export function shouldClearOverrideAfterPatchError(
  current: PendingContextModelOverride | null | undefined,
  attempted: PendingContextModelOverride,
): boolean {
  return current === attempted;
}

export function shouldClearPendingContextModelOverride(
  current: PendingContextModelOverride | null | undefined,
  target: PendingContextModelClearTarget,
  usageRefreshed: boolean,
): boolean {
  return (
    usageRefreshed &&
    current?.sessionKey === target.sessionKey &&
    current.model === target.model &&
    current.runId != null &&
    current.runId === target.runId
  );
}
