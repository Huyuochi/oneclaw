import { contextBridge, ipcRenderer, webUtils } from "electron";

type AttachmentCandidate = {
  name?: string;
  filePath?: string;
  dataUrl?: string;
  mimeType?: string;
};

type AttachmentCandidateResult = {
  attachments: AttachmentCandidate[];
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

function extnameLower(value: string): string {
  const cleanValue = value.split(/[?#]/, 1)[0] ?? value;
  const dotIndex = cleanValue.lastIndexOf(".");
  return dotIndex >= 0 ? cleanValue.slice(dotIndex).toLowerCase() : "";
}

function fileNameFromPath(value: string): string {
  return value.split(/[/\\]/).pop() || value;
}

function imageMimeTypeForName(value: string): string | null {
  return IMAGE_MIME_BY_EXT[extnameLower(value)] ?? null;
}

function fileLooksLikeImage(file: File, filePath: string): boolean {
  return file.type.startsWith("image/") || Boolean(imageMimeTypeForName(filePath || file.name));
}

function readDroppedImageDataUrl(file: File, filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => resolve(null));
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const match = /^data:[^;]*;base64,(.+)$/i.exec(result);
      const mimeType = file.type.startsWith("image/")
        ? file.type
        : imageMimeTypeForName(filePath || file.name);
      resolve(match && mimeType ? `data:${mimeType};base64,${match[1]}` : null);
    });
    reader.readAsDataURL(file);
  });
}

async function buildDroppedAttachmentResult(files: FileList): Promise<AttachmentCandidateResult> {
  // drop 是唯一不经过主进程 picker/clipboard 的文件入口；图片只从本次拖入的 File 对象读，
  // 读取失败不回退成 path-only 图片，避免重新引入“按路径读图片”的边界。
  const attachments: AttachmentCandidate[] = [];
  let rejectedImageCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) {
      continue;
    }
    let filePath = "";
    try {
      filePath = webUtils.getPathForFile(file);
    } catch {
      filePath = "";
    }
    const name = file.name || fileNameFromPath(filePath);
    if (fileLooksLikeImage(file, filePath)) {
      const dataUrl = await readDroppedImageDataUrl(file, filePath);
      if (dataUrl) {
        attachments.push({
          name,
          dataUrl,
          mimeType: file.type.startsWith("image/")
            ? file.type
            : imageMimeTypeForName(filePath || name) ?? undefined,
        });
      } else {
        rejectedImageCount++;
      }
      continue;
    }
    if (filePath) {
      attachments.push({ name, filePath });
    }
  }
  return { attachments, rejectedImageCount };
}

// 安全桥接 — 向渲染进程暴露有限 API
contextBridge.exposeInMainWorld("oneclaw", {
  // Gateway 控制
  restartGateway: () => ipcRenderer.send("gateway:restart"),
  startGateway: () => ipcRenderer.send("gateway:start"),
  stopGateway: () => ipcRenderer.invoke("gateway:stop"),
  getGatewayState: () => ipcRenderer.invoke("gateway:state"),

  // 自动更新
  checkForUpdates: () => ipcRenderer.send("app:check-updates"),
  getUpdateState: () => ipcRenderer.invoke("app:get-update-state"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("app:download-and-install-update"),

  // Setup 相关
  verifyKey: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("setup:verify-key", params),
  saveConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("setup:save-config", params),
  setupGetLaunchAtLogin: () => ipcRenderer.invoke("setup:get-launch-at-login"),
  completeSetup: (params?: Record<string, unknown>) => ipcRenderer.invoke("setup:complete", params),
  detectInstallation: () => ipcRenderer.invoke("setup:detect-installation"),
  resolveConflict: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("setup:resolve-conflict", params),

  // Kimi OAuth
  kimiOAuthLogin: () => ipcRenderer.invoke("kimi-oauth:login"),
  kimiOAuthCancel: () => ipcRenderer.invoke("kimi-oauth:cancel"),
  kimiOAuthLogout: () => ipcRenderer.invoke("kimi-oauth:logout"),
  kimiOAuthStatus: () => ipcRenderer.invoke("kimi-oauth:status"),
  kimiGetUsage: () => ipcRenderer.invoke("kimi:get-usage"),

  // Settings 相关
  settingsGetConfig: () => ipcRenderer.invoke("settings:get-config"),
  settingsVerifyKey: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:verify-key", params),
  settingsSaveProvider: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-provider", params),
  settingsGetChannelConfig: () => ipcRenderer.invoke("settings:get-channel-config"),
  settingsSaveChannel: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-channel", params),
  settingsGetQqbotConfig: () => ipcRenderer.invoke("settings:get-qqbot-config"),
  settingsSaveQqbotConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-qqbot-config", params),
  settingsGetWeixinConfig: () => ipcRenderer.invoke("settings:get-weixin-config"),
  settingsSaveWeixinConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-weixin-config", params),
  settingsWeixinLoginStart: () =>
    ipcRenderer.invoke("settings:weixin-login-start"),
  settingsWeixinLoginWait: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:weixin-login-wait", params),
  settingsWeixinClearAccounts: () =>
    ipcRenderer.invoke("settings:weixin-clear-accounts"),
  settingsGetDingtalkConfig: () => ipcRenderer.invoke("settings:get-dingtalk-config"),
  settingsSaveDingtalkConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-dingtalk-config", params),
  settingsGetWecomConfig: () => ipcRenderer.invoke("settings:get-wecom-config"),
  settingsSaveWecomConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-wecom-config", params),
  settingsListWecomPairing: () =>
    ipcRenderer.invoke("settings:list-wecom-pairing"),
  settingsApproveWecomPairing: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:approve-wecom-pairing", params),
  settingsRejectWecomPairing: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:reject-wecom-pairing", params),
  settingsListWecomApproved: () =>
    ipcRenderer.invoke("settings:list-wecom-approved"),
  settingsAddWecomUserAllowFrom: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:add-wecom-user-allow-from", params),
  settingsAddWecomGroupAllowFrom: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:add-wecom-group-allow-from", params),
  settingsRemoveWecomApproved: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:remove-wecom-approved", params),
  settingsListFeishuPairing: () =>
    ipcRenderer.invoke("settings:list-feishu-pairing"),
  settingsApproveFeishuPairing: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:approve-feishu-pairing", params),
  settingsRejectFeishuPairing: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:reject-feishu-pairing", params),
  settingsListFeishuApproved: () =>
    ipcRenderer.invoke("settings:list-feishu-approved"),
  settingsAddFeishuUserAllowFrom: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:add-feishu-user-allow-from", params),
  settingsAddFeishuGroupAllowFrom: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:add-feishu-group-allow-from", params),
  settingsRemoveFeishuApproved: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:remove-feishu-approved", params),
  settingsGetKimiConfig: () => ipcRenderer.invoke("settings:get-kimi-config"),
  settingsSaveKimiConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-kimi-config", params),
  settingsGetKimiSearchConfig: () => ipcRenderer.invoke("settings:get-kimi-search-config"),
  settingsSaveKimiSearchConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-kimi-search-config", params),
  settingsGetMemoryConfig: () => ipcRenderer.invoke("settings:get-memory-config"),
  settingsSaveMemoryConfig: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-memory-config", params),
  settingsGetAboutInfo: () => ipcRenderer.invoke("settings:get-about-info"),
  settingsGetAdvanced: () => ipcRenderer.invoke("settings:get-advanced"),
  settingsSaveAdvanced: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:save-advanced", params),
  settingsWebbridgeStatus: () => ipcRenderer.invoke("settings:webbridge-status"),
  settingsWebbridgeInstallExtensions: () =>
    ipcRenderer.invoke("settings:webbridge-install-extensions"),
  settingsWebbridgeCleanBlocklist: (browserId: string) =>
    ipcRenderer.invoke("settings:webbridge-clean-blocklist", browserId),
  settingsWebbridgePrecheck: () =>
    ipcRenderer.invoke("settings:webbridge-precheck"),
  settingsWebbridgeRepairAndEnable: () =>
    ipcRenderer.invoke("settings:webbridge-repair-and-enable"),
  settingsGetDefaultBrowserName: () =>
    ipcRenderer.invoke("settings:get-default-browser-name"),
  // 主窗左侧栏 WebBridge 修复 pill 用：返回 { visible: boolean }
  settingsWebbridgeNeedsRepair: () =>
    ipcRenderer.invoke("settings:webbridge-needs-repair"),
  // 主窗左侧栏 pill 点击时调用：清 blocklist + 写 External JSON（仅当浏览器已关闭）
  settingsWebbridgePillRepair: () =>
    ipcRenderer.invoke("settings:webbridge-pill-repair"),
  settingsGetCliStatus: () => ipcRenderer.invoke("settings:get-cli-status"),
  settingsInstallCli: () => ipcRenderer.invoke("settings:install-cli"),
  settingsUninstallCli: () => ipcRenderer.invoke("settings:uninstall-cli"),
  settingsListConfigBackups: () => ipcRenderer.invoke("settings:list-config-backups"),
  settingsExportOpenclawState: () => ipcRenderer.invoke("settings:export-openclaw-state"),
  settingsSelectOpenclawStateArchive: () => ipcRenderer.invoke("settings:select-openclaw-state-archive"),
  settingsImportOpenclawState: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:import-openclaw-state", params),
  settingsRestoreConfigBackup: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:restore-config-backup", params),
  settingsRestoreLastKnownGood: () => ipcRenderer.invoke("settings:restore-last-known-good"),
  settingsResetConfigAndRelaunch: () => ipcRenderer.invoke("settings:reset-config-and-relaunch"),
  settingsGetShareCopy: () => ipcRenderer.invoke("settings:get-share-copy"),

  // 多模型管理
  settingsGetConfiguredModels: () => ipcRenderer.invoke("settings:get-configured-models"),
  settingsDeleteModel: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:delete-model", params),
  settingsSetDefaultModel: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:set-default-model", params),
  settingsUpdateModelAlias: (params: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:update-model-alias", params),

  // 技能商店
  skillStoreList: (params?: Record<string, unknown>) =>
    ipcRenderer.invoke("skill-store:list", params),
  skillStoreSearch: (params?: Record<string, unknown>) =>
    ipcRenderer.invoke("skill-store:search", params),
  skillStoreDetail: (params?: Record<string, unknown>) =>
    ipcRenderer.invoke("skill-store:detail", params),
  skillStoreInstall: (params?: Record<string, unknown>) =>
    ipcRenderer.invoke("skill-store:install", params),
  skillStoreUninstall: (params?: Record<string, unknown>) =>
    ipcRenderer.invoke("skill-store:uninstall", params),
  skillStoreListInstalled: () =>
    ipcRenderer.invoke("skill-store:list-installed"),

  // 工作空间文件操作
  workspaceSetRoot: (root: string) =>
    ipcRenderer.invoke("workspace:set-root", root),
  workspaceOpenFile: (filePath: string) =>
    ipcRenderer.invoke("workspace:open-file", filePath),
  workspaceOpenFolder: (filePath: string) =>
    ipcRenderer.invoke("workspace:open-folder", filePath),
  workspaceListDir: (dirPath: string) =>
    ipcRenderer.invoke("workspace:list-dir", dirPath),
  workspaceReadFile: (filePath: string) =>
    ipcRenderer.invoke("workspace:read-file", filePath),

  onSettingsNavigate: (cb: (payload: { tab: string; notice: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { tab: string; notice: string }) => cb(payload);
    ipcRenderer.on("settings:navigate", handler);
    return () => { ipcRenderer.removeListener("settings:navigate", handler); };
  },

  // 打开外部链接（走 IPC 到主进程，sandbox 下 shell 不可用）
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  // 打开本地文件/目录
  openPath: (path: string) => ipcRenderer.invoke("app:open-path", path),

  // 文件选择
  selectFileAttachments: (
    options?: { filters?: Array<{ name: string; extensions: string[] }>; allowImages?: boolean },
  ) => ipcRenderer.invoke("dialog:select-file-attachments", options) as Promise<AttachmentCandidateResult>,
  readClipboardFileAttachments: (options?: { allowImages?: boolean }) =>
    ipcRenderer.invoke("clipboard:read-file-attachments", options) as Promise<AttachmentCandidateResult>,
  // 读取系统剪贴板位图，补齐 DOM paste 拿不到图片项的场景。
  readClipboardImage: () =>
    ipcRenderer.invoke("clipboard:read-image-data-url") as Promise<string | null>,

  // Release Notes
  getReleaseNotes: () => ipcRenderer.invoke("app:get-release-notes"),
  dismissReleaseNotes: (version: string) => ipcRenderer.invoke("app:dismiss-release-notes", version),

  // Chat UI 侧边栏操作
  quit: () => ipcRenderer.send("app:quit"),
  reportSetupViewState: (active: boolean) => ipcRenderer.send("app:setup-view-state", active),
  openSettings: () => ipcRenderer.send("app:open-settings"),
  openWebUI: () => ipcRenderer.send("app:open-webui"),
  getGatewayPort: () => ipcRenderer.invoke("gateway:port"),
  // 主进程通知 gateway 已就绪，Chat UI 可立即重连（跳过盲等指数退避）
  onGatewayReady: (cb: (payload?: { token?: string | null; gatewayUrl?: string | null }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload?: { token?: string | null; gatewayUrl?: string | null },
    ) => cb(payload);
    ipcRenderer.on("gateway:ready", listener);
    return () => ipcRenderer.removeListener("gateway:ready", listener);
  },
  // 主进程通知 webbridge precheck 状态可能已变（setup-task 后台装完扩展、settings 修复完成等）
  // chat-ui 据此重查 settings:webbridge-needs-repair，避免 pill 卡在旧结果
  onWebbridgeStateChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("webbridge:state-changed", listener);
    return () => ipcRenderer.removeListener("webbridge:state-changed", listener);
  },

  // 截取当前窗口截图，返回 base64 PNG
  captureWindow: () => ipcRenderer.invoke("feedback:capture-window"),
  // 提交用户反馈
  submitFeedback: (params: { content: string; screenshots: string[]; fileNames?: string[]; includeLogs: boolean; email?: string }) =>
    ipcRenderer.invoke("feedback:submit", params),
  // 获取反馈 thread 列表
  feedbackThreads: () => ipcRenderer.invoke("feedback:threads"),
  // 获取单个反馈 thread 详情
  feedbackThread: (id: number) => ipcRenderer.invoke("feedback:thread", id),
  // 用户追问（支持附件）
  feedbackReply: (id: number, content: string, files?: Array<{name: string; base64: string}>) =>
    ipcRenderer.invoke("feedback:reply", id, content, files),
  // 从 .openclaw 目录选择文件
  feedbackPickFiles: () => ipcRenderer.invoke("feedback:pick-files"),
  // 弹出原生错误对话框
  feedbackShowErrorDialog: (params: { title: string; message: string; detail?: string }) =>
    ipcRenderer.invoke("feedback:show-error-dialog", params),
  // SSE 订阅：建连 / 断开
  feedbackSubscribe: () => ipcRenderer.invoke("feedback:subscribe"),
  feedbackUnsubscribe: () => ipcRenderer.invoke("feedback:unsubscribe"),

  // SSE 事件监听（返回 unsubscribe 函数，遵循项目既有 onGatewayReady / onAppNavigate 模式）
  onFeedbackEvent: (cb: (evt: unknown) => void) => {
    const listener = (_e: unknown, evt: unknown) => cb(evt);
    ipcRenderer.on("feedback:event", listener);
    return () => ipcRenderer.removeListener("feedback:event", listener);
  },
  onFeedbackReconnecting: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("feedback:reconnecting", listener);
    return () => ipcRenderer.removeListener("feedback:reconnecting", listener);
  },
  onFeedbackReconnected: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("feedback:reconnected", listener);
    return () => ipcRenderer.removeListener("feedback:reconnected", listener);
  },
  onFeedbackOpen: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("feedback:open", listener);
    return () => ipcRenderer.removeListener("feedback:open", listener);
  },
  onNavigate: (cb: (payload: { view: "settings" | "setup" | "chat"; settingsTab?: string | null; settingsNotice?: string | null; token?: string | null }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { view: "settings" | "setup" | "chat"; settingsTab?: string | null; settingsNotice?: string | null; token?: string | null }) => {
      cb(payload);
    };
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  },
  onUpdateState: (
    cb: (payload: {
      status: "hidden" | "available" | "downloading";
      version: string | null;
      percent: number | null;
      showBadge: boolean;
    }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        status: "hidden" | "available" | "downloading";
        version: string | null;
        percent: number | null;
        showBadge: boolean;
      },
    ) => {
      cb(payload);
    };
    ipcRenderer.on("app:update-state", listener);
    return () => ipcRenderer.removeListener("app:update-state", listener);
  },
});

// 拖拽文件 → 提取路径并派发给渲染进程
// dragover 必须无条件 preventDefault，否则 drop 事件不会触发
document.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const files = e.dataTransfer?.files;
  if (!files?.length) return;
  // 设计取舍（已评估，可接受）：默认图片体积小、dataUrl 转换近乎瞬时，这里读到即追加 / 发送不等待，
  // 不再跟踪 pending、不快照冻结 composer。已知边界：超大图片刚粘贴/拖入就立刻回车，该附件可能来不及
  // 读完而漏发（仍可在下一次发送时带上）。这是为换取无竞态的简单路径主动接受的取舍，非缺陷，
  // 也无需按“大图上传风险”加固。
  void buildDroppedAttachmentResult(files)
    .then((detail) => {
      window.dispatchEvent(new CustomEvent("oneclaw:file-drop", { detail }));
    })
    .catch(() => {
      window.dispatchEvent(new CustomEvent("oneclaw:file-drop", {
        detail: { attachments: [], rejectedImageCount: 0 },
      }));
    });
});
