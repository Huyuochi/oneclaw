import type {
  ChatAttachment,
  ChatAttachmentCandidate,
  ChatAttachmentCandidateResult,
  ConfiguredModel,
} from "../ui-types.ts";

// 图片扩展名 → MIME：Chat UI 侧用于门控和预览；主进程/预加载脚本有各自进程内副本。
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};
const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_BY_EXT));

// 提取小写扩展名（去掉 query/hash），无扩展名时返回空串。
function extnameLower(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path;
  const dotIndex = cleanPath.lastIndexOf(".");
  return dotIndex >= 0 ? cleanPath.slice(dotIndex).toLowerCase() : "";
}

// 用已配置模型列表判断当前模型是否支持图片，避免 UI 侧再做额外探测。
export function currentModelSupportsImages(
  models: ConfiguredModel[] | undefined,
  currentModel: string | null | undefined,
): boolean {
  if (!currentModel) {
    return false;
  }
  return models?.find((model) => model.key === currentModel)?.supportsImage === true;
}

// 仅用扩展名做轻量图片判断，上传门禁需要一个同步、低成本的检查。
export function pathLooksLikeImage(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  return IMAGE_EXTENSIONS.has(extnameLower(path));
}

// 从附件的 dataUrl、url、MIME 或路径兜底判断图片，发送前拦截需要覆盖所有上传入口。
export function attachmentLooksLikeImage(attachment: Partial<ChatAttachment>): boolean {
  if (typeof attachment.dataUrl === "string" && /^data:image\//i.test(attachment.dataUrl)) {
    return true;
  }
  if (typeof attachment.url === "string" && /^data:image\//i.test(attachment.url)) {
    return true;
  }
  const mimeType =
    typeof attachment.type === "string"
      ? attachment.type
      : typeof attachment.mimeType === "string"
        ? attachment.mimeType
        : "";
  if (/^image\//i.test(mimeType)) {
    return true;
  }
  return pathLooksLikeImage(attachment.filePath) || pathLooksLikeImage(attachment.url);
}

// 发送、追加、队列共用的图片门控判定：附件含图片且当前模型不支持图片时返回 true。
// 集中一处定义，避免各调用点各写一份判定而逐渐漂移。
export function attachmentsBlockedByModel(
  attachments: ReadonlyArray<Partial<ChatAttachment>> | undefined,
  models: ConfiguredModel[] | undefined,
  currentModel: string | null | undefined,
): boolean {
  if (!attachments?.some(attachmentLooksLikeImage)) {
    return false;
  }
  return !currentModelSupportsImages(models, currentModel);
}

// 为 UI 附件生成本地 id，删除附件和测试注入都需要一个统一的 id 来源。
export function createAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// 从跨平台路径提取文件名，避免 Windows 反斜杠在 macOS/Linux 上被当作普通字符。
export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

// 读取 data URL 自带的 MIME，优先保留剪贴板或文件读取返回的真实类型。
export function mimeTypeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;]+);base64,/i.exec(dataUrl);
  return match?.[1] ?? null;
}

function hasImageDataUrl(candidate: ChatAttachmentCandidate): candidate is ChatAttachmentCandidate & {
  dataUrl: string;
} {
  return typeof candidate.dataUrl === "string" && /^data:image\/[^;]+;base64,/i.test(candidate.dataUrl);
}

function candidatePathLooksLikeImage(candidate: ChatAttachmentCandidate): boolean {
  const mimeType =
    typeof candidate.type === "string"
      ? candidate.type
      : typeof candidate.mimeType === "string"
        ? candidate.mimeType
        : "";
  return /^image\//i.test(mimeType) ||
    pathLooksLikeImage(candidate.filePath) ||
    pathLooksLikeImage(candidate.name);
}

// 所有附件入口都先归一到这里：图片必须已有 dataUrl，path-only 图片不能降级成普通文件。
export function normalizeAttachmentCandidates(
  result: ChatAttachmentCandidateResult | null | undefined,
  supportsImages: boolean,
  makeId: () => string = createAttachmentId,
): { attachments: ChatAttachment[]; rejectedImageCount: number } {
  const attachments: ChatAttachment[] = [];
  let rejectedImageCount = result?.rejectedImageCount ?? 0;
  for (const candidate of result?.attachments ?? []) {
    if (hasImageDataUrl(candidate)) {
      if (!supportsImages) {
        rejectedImageCount++;
        continue;
      }
      attachments.push({
        ...candidate,
        id: makeId(),
        mimeType: candidate.mimeType ?? mimeTypeFromDataUrl(candidate.dataUrl) ?? "image/png",
      });
      continue;
    }
    if (candidatePathLooksLikeImage(candidate)) {
      rejectedImageCount++;
      continue;
    }
    if (typeof candidate.filePath === "string" && candidate.filePath) {
      attachments.push({
        ...candidate,
        id: makeId(),
        name: candidate.name ?? fileNameFromPath(candidate.filePath),
      });
    }
  }
  return { attachments, rejectedImageCount };
}

// 统一决定附件预览地址，避免渲染层分别猜测 dataUrl 和 url。
export function attachmentPreviewUrl(attachment: ChatAttachment): string | null {
  if (typeof attachment.dataUrl === "string" && attachment.dataUrl) {
    return attachment.dataUrl;
  }
  if (typeof attachment.url === "string" && /^data:image\//i.test(attachment.url)) {
    return attachment.url;
  }
  return null;
}
