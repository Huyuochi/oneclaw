/**
 * Settings: Session Usage Tab.
 * Read-only listing of all sessions across agents with cumulative token usage.
 * Pulls exact tokens from gateway `sessions.usage` (CostUsageTotals: input/output/cacheRead).
 */
import { html, nothing } from "lit";
import type { AppViewState } from "../../app-view-state.ts";
import { t, tWithDetail } from "../../i18n.ts";
import "../../components/message-box.ts";

const MAX_ROWS = 200;

interface SessionUsageRow {
  agent: string;
  sessionId: string;
  isMain: boolean;
  customLabel: string | null;
  originLabel: string | null;
  updatedAt: number;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
}

const s = {
  rows: [] as SessionUsageRow[],
  loading: false,
  error: null as string | null,
  initialized: false,
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function pickToken(usage: unknown, key: "input" | "output" | "cacheRead"): number | null {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Gateway archives deleted/reset transcripts as `<id>.jsonl.deleted.<ISO>Z` / `.reset.<ISO>Z`
// (see openclaw config/sessions/artifacts.ts). discoverAllSessions still surfaces these as
// unnamed zero-token entries; hide them so the listing matches the chat sidebar.
const ARCHIVED_TRANSCRIPT_RE =
  /\.jsonl\.(?:deleted|reset)\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z$/;

function isArchivedTranscript(usage: unknown): boolean {
  if (!isRecord(usage)) return false;
  const sessionFile = usage.sessionFile;
  return typeof sessionFile === "string" && ARCHIVED_TRANSCRIPT_RE.test(sessionFile);
}

function isMainSessionKey(sessionKey: string, agent: string): boolean {
  // Default main session key shape is `agent:<agentId>:main`. A custom mainKey
  // simply won't get the badge — covers the overwhelming majority of users.
  const lower = sessionKey.toLowerCase();
  return lower === `agent:${agent.toLowerCase()}:main` || lower === "main";
}

function todayDateStringUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mapEntries(payload: unknown): SessionUsageRow[] {
  if (!isRecord(payload)) return [];
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const rows: SessionUsageRow[] = [];
  for (const entry of sessions) {
    if (!isRecord(entry)) continue;
    if (isArchivedTranscript(entry.usage)) continue;
    const sessionId = asString(entry.sessionId);
    if (!sessionId) continue;
    const key = asString(entry.key) ?? "";
    const agent = asString(entry.agentId) ?? "";
    const origin = isRecord(entry.origin) ? entry.origin : null;
    rows.push({
      agent,
      sessionId,
      isMain: isMainSessionKey(key, agent),
      customLabel: asString(entry.label),
      originLabel: origin ? asString(origin.label) : null,
      updatedAt: asNumber(entry.updatedAt),
      input: pickToken(entry.usage, "input"),
      output: pickToken(entry.usage, "output"),
      cacheRead: pickToken(entry.usage, "cacheRead"),
    });
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows.slice(0, MAX_ROWS);
}

async function init(state: AppViewState) {
  if (s.initialized) return;
  s.initialized = true;
  s.loading = true;
  state.requestUpdate();
  try {
    const client = state.client;
    if (!client || !state.connected) {
      throw new Error("gateway not connected");
    }
    const payload = await client.request("sessions.usage", {
      startDate: "1970-01-01",
      endDate: todayDateStringUtc(),
      limit: MAX_ROWS,
    });
    s.rows = mapEntries(payload);
    s.error = null;
  } catch (e: any) {
    s.rows = [];
    s.error = tWithDetail("settings.error.loadFailed", e?.message);
  } finally {
    s.loading = false;
    state.requestUpdate();
  }
}

export function resetSessionUsageTab() {
  s.initialized = false;
  s.rows = [];
  s.error = null;
  s.loading = false;
}

function formatDateTime(ms: number): string {
  if (!ms) return "";
  try { return new Date(ms).toLocaleString(); } catch { return ""; }
}

function formatToken(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function renderTotals(rows: SessionUsageRow[]) {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  for (const r of rows) {
    if (typeof r.input === "number" && Number.isFinite(r.input)) input += r.input;
    if (typeof r.output === "number" && Number.isFinite(r.output)) output += r.output;
    if (typeof r.cacheRead === "number" && Number.isFinite(r.cacheRead)) cacheRead += r.cacheRead;
  }
  return html`
    <div class="oc-session-usage__totals">
      <div class="oc-session-usage__totals-label">${t("settings.sessionUsage.totals.label")}</div>
      <div class="oc-session-usage__totals-tokens">
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenIn")}</span> ${formatToken(input)}</span>
        <span class="oc-session-usage__sep">·</span>
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenOut")}</span> ${formatToken(output)}</span>
        <span class="oc-session-usage__sep">·</span>
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenCacheRead")}</span> ${formatToken(cacheRead)}</span>
      </div>
    </div>
  `;
}

function renderRow(row: SessionUsageRow) {
  const label = row.customLabel || row.originLabel;
  return html`
    <div class="oc-session-usage__row">
      <div class="oc-session-usage__row-head">
        ${row.isMain ? html`<span class="oc-session-usage__badge">${t("settings.sessionUsage.mainBadge")}</span>` : nothing}
        ${label
          ? html`<span class="oc-session-usage__label" title=${label}>${label}</span>`
          : row.isMain
            ? nothing
            : html`<span class="oc-session-usage__label oc-session-usage__label--muted">${t("settings.sessionUsage.unlabeled")}</span>`}
        <span class="oc-session-usage__time">${formatDateTime(row.updatedAt)}</span>
      </div>
      <div class="oc-session-usage__row-tokens">
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenIn")}</span> ${formatToken(row.input)}</span>
        <span class="oc-session-usage__sep">·</span>
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenOut")}</span> ${formatToken(row.output)}</span>
        <span class="oc-session-usage__sep">·</span>
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenCacheRead")}</span> ${formatToken(row.cacheRead)}</span>
      </div>
    </div>
  `;
}

export function renderTabSessionUsage(state: AppViewState) {
  if (!s.initialized) init(state);

  return html`
    <div class="oc-settings__section">
      <h2 class="oc-settings__section-title">${t("settings.sessionUsage.pageTitle")}</h2>
      <p class="oc-settings__hint">${t("settings.sessionUsage.pageDesc")}</p>

      <div class="oc-settings__card">
        ${s.loading
          ? html`<div class="oc-session-usage__empty">…</div>`
          : s.rows.length
            ? html`
                ${renderTotals(s.rows)}
                <div class="oc-session-usage__list">${s.rows.map(renderRow)}</div>
              `
            : html`<div class="oc-session-usage__empty">${t("settings.sessionUsage.empty")}</div>`}
      </div>

      <oc-message-box .message=${s.error ?? ""} .type=${"error"} .visible=${!!s.error}></oc-message-box>
    </div>
  `;
}

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(/* css */`
  .oc-session-usage__totals {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    margin-bottom: 12px;
    border: 1px solid var(--border-strong, var(--border, #d4d4d8));
    border-radius: var(--radius-md, 10px);
    background: var(--bg-input, #f5f5f5);
  }
  .oc-session-usage__totals-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-strong, #18181b);
    letter-spacing: 0.02em;
  }
  .oc-session-usage__totals-tokens {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong, #18181b);
    font-variant-numeric: tabular-nums;
  }
  .oc-session-usage__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .oc-session-usage__row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--border-strong, var(--border, #d4d4d8));
    border-radius: var(--radius-md, 10px);
    background: var(--bg-secondary, #fbfbfb);
    box-shadow: none;
    transition: background var(--duration-fast, 0.12s) ease, border-color var(--duration-fast, 0.12s) ease;
  }
  .oc-session-usage__row:hover {
    background: var(--bg-hover, #ebebeb);
    border-color: var(--border-strong, var(--border, #d4d4d8));
  }
  .oc-session-usage__row-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .oc-session-usage__badge {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--accent-fg, #ffffff);
    background: var(--accent, #c0392b);
    padding: 2px 8px;
    border-radius: var(--radius-sm, 6px);
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }
  .oc-session-usage__label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-strong, #18181b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .oc-session-usage__label--muted {
    color: var(--text-muted, #a1a1aa);
    font-weight: 400;
    font-style: italic;
  }
  .oc-session-usage__time {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--text-muted, #a1a1aa);
    flex-shrink: 0;
  }
  .oc-session-usage__row-tokens {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 2px;
    font-size: 12.5px;
    color: var(--text-secondary, #71717a);
    font-variant-numeric: tabular-nums;
  }
  .oc-session-usage__tag {
    color: var(--text-muted, #a1a1aa);
    margin-right: 2px;
  }
  .oc-session-usage__sep {
    color: var(--text-muted, #d4d4d8);
  }
  .oc-session-usage__empty {
    font-size: 12.5px;
    color: var(--text-muted, #a1a1aa);
    padding: 4px 0;
  }
  @media (max-width: 640px) {
    .oc-session-usage__row-head {
      flex-wrap: wrap;
    }
    .oc-session-usage__badge {
      width: fit-content;
    }
  }
`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, styleSheet];
