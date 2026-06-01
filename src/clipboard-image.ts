type Platform = NodeJS.Platform;

export type ClipboardImageRetryOptions = {
  platform?: Platform;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const WINDOWS_CLIPBOARD_IMAGE_ATTEMPTS = 3;
const WINDOWS_CLIPBOARD_IMAGE_RETRY_MS = 40;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAttemptsForPlatform(platform: Platform, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(1, Math.floor(explicit));
  }
  return platform === "win32" ? WINDOWS_CLIPBOARD_IMAGE_ATTEMPTS : 1;
}

export async function readClipboardImageDataUrlWithRetry(
  readOnce: () => string | null,
  options: ClipboardImageRetryOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const attempts = retryAttemptsForPlatform(platform, options.attempts);
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? WINDOWS_CLIPBOARD_IMAGE_RETRY_MS));
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const dataUrl = readOnce();
    if (dataUrl) {
      return dataUrl;
    }
    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return null;
}
