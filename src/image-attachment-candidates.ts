import * as fs from "fs";
import * as path from "path";

export type FileAttachmentCandidate = {
  name?: string;
  filePath?: string;
  dataUrl?: string;
  mimeType?: string;
};

export type FileAttachmentResult = {
  attachments: FileAttachmentCandidate[];
  rejectedImageCount: number;
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

function imageMimeTypeForPath(filePath: string): string | null {
  return IMAGE_MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? null;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || path.basename(filePath);
}

export async function buildFileAttachmentResult(
  filePaths: string[],
  options: { allowImages?: boolean } = {},
): Promise<FileAttachmentResult> {
  // 这里仅处理已由主进程自身用户入口产生的路径（文件选择器/当前剪贴板文件列表）；
  // 不接收 renderer 传入的任意路径，图片失败也不能降级为 path-only 文件。
  const allowImages = options.allowImages !== false;
  const attachments: FileAttachmentCandidate[] = [];
  let rejectedImageCount = 0;
  for (const filePath of filePaths) {
    if (typeof filePath !== "string" || !filePath) {
      continue;
    }
    const name = fileNameFromPath(filePath);
    const mimeType = imageMimeTypeForPath(filePath);
    if (!mimeType) {
      attachments.push({ name, filePath });
      continue;
    }
    if (!allowImages) {
      rejectedImageCount++;
      continue;
    }
    try {
      const content = await fs.promises.readFile(filePath);
      attachments.push({
        name,
        mimeType,
        dataUrl: `data:${mimeType};base64,${content.toString("base64")}`,
      });
    } catch {
      rejectedImageCount++;
    }
  }
  return { attachments, rejectedImageCount };
}
