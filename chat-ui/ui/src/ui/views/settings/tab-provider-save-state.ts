import type { ConfiguredModel } from "../../data/ipc-bridge.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function resolveAddedModelKey(
  saveResult: unknown,
  previousModelKeys: ReadonlySet<string>,
  configuredModels: ConfiguredModel[],
): string | null {
  if (isRecord(saveResult) && typeof saveResult.modelKey === "string" && saveResult.modelKey.length > 0) {
    return saveResult.modelKey;
  }

  return configuredModels.find((model) => !previousModelKeys.has(model.key))?.key ?? null;
}
