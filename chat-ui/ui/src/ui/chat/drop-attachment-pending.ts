export type DropAttachmentContext = {
  contextKey: string;
  supportsImages: boolean;
};

export type DropAttachmentPendingRecord = DropAttachmentContext & {
  pending: Promise<void>;
  settle: () => void;
};

function createPendingRecord(
  pendingDrops: Map<string, DropAttachmentPendingRecord>,
  dropId: string,
  context: DropAttachmentContext,
): DropAttachmentPendingRecord {
  let resolvePending: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    resolvePending = resolve;
  });
  let settled = false;
  const record: DropAttachmentPendingRecord = {
    ...context,
    pending,
    settle: () => {
      if (settled) {
        return;
      }
      settled = true;
      pendingDrops.delete(dropId);
      resolvePending();
    },
  };
  return record;
}

// drop 开始时同步登记 pending，并把当时的会话/模型能力冻结到记录里。
export function registerDropAttachmentPending(
  pendingDrops: Map<string, DropAttachmentPendingRecord>,
  dropId: string | null | undefined,
  context: DropAttachmentContext,
  trackPending: (pending: Promise<void>) => void,
): void {
  if (!dropId) {
    return;
  }
  pendingDrops.get(dropId)?.settle();
  const record = createPendingRecord(pendingDrops, dropId, context);
  pendingDrops.set(dropId, record);
  trackPending(record.pending);
}

// drop 完成时优先取开始时冻结的上下文；没有 start 事件时回退到当前上下文兼容旧事件。
export function takeDropAttachmentPending(
  pendingDrops: Map<string, DropAttachmentPendingRecord>,
  dropId: string | null | undefined,
  fallback: DropAttachmentContext,
): DropAttachmentPendingRecord {
  const record = dropId ? pendingDrops.get(dropId) : undefined;
  if (record) {
    return record;
  }
  return {
    ...fallback,
    pending: Promise.resolve(),
    settle: () => {},
  };
}
