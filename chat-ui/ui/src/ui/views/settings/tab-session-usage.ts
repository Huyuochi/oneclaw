import { html, nothing } from "lit";
import type { AppViewState } from "../../app-view-state.ts";
import { t } from "../../i18n.ts";
import "../../components/message-box.ts";
import { formatTokens } from "../usage-metrics.ts";
import {
  beginSessionUsageLoad,
  formatSessionUsageLimitNotice,
  loadSessionUsageSnapshot,
  type SessionUsageRow,
  type UsageTotals,
} from "./tab-session-usage.lib.ts";

const s = {
  rows: [] as SessionUsageRow[],
  totals: null as UsageTotals | null,
  totalSessions: 0,
  loading: false,
  error: null as string | null,
  initialized: false,
  wasConnected: false,
};

async function init(state: AppViewState) {
  const client = state.client;
  if (!beginSessionUsageLoad(s, state.connected, !!client) || !client) return;
  s.error = null;
  state.requestUpdate();
  try {
    const mapped = await loadSessionUsageSnapshot((method, params) => client.request(method, params));
    s.rows = mapped.rows;
    s.totals = mapped.totals;
    s.totalSessions = mapped.totalSessions;
    s.error = null;
  } catch {
    s.rows = [];
    s.totals = null;
    s.totalSessions = 0;
    s.error = t("settings.sessionUsage.loadFailedHint");
  } finally {
    s.loading = false;
    state.requestUpdate();
  }
}

export function resetSessionUsageTab() {
  s.initialized = false;
  s.rows = [];
  s.totals = null;
  s.totalSessions = 0;
  s.error = null;
  s.loading = false;
  s.wasConnected = false;
}

function formatDateTime(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : "";
}

function formatToken(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "—" : formatTokens(n);
}

// cacheWrite is intentionally omitted from totals/rows — see tab-session-usage.lib.ts.
function renderTotals(totals: UsageTotals) {
  return html`
    <div class="oc-session-usage__totals">
      <div class="oc-session-usage__totals-label">${t("settings.sessionUsage.totals.label")}</div>
      <div class="oc-session-usage__totals-tokens">
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenIn")}</span> ${formatToken(totals.input)}</span>
        <span class="oc-session-usage__sep">·</span>
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenOut")}</span> ${formatToken(totals.output)}</span>
        <span class="oc-session-usage__sep">·</span>
        <span><span class="oc-session-usage__tag">${t("settings.sessionUsage.tokenCacheRead")}</span> ${formatToken(totals.cacheRead)}</span>
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
  // Reset on disconnect so a stale "load failed" doesn't persist after the gateway comes back.
  if (s.wasConnected && !state.connected) s.initialized = false;
  s.wasConnected = state.connected;
  if (!s.initialized && !s.loading && state.connected && state.client) init(state);

  return html`
    <div class="oc-settings__section">
      <h2 class="oc-settings__section-title">${t("settings.sessionUsage.pageTitle")}</h2>
      <p class="oc-settings__hint">${t("settings.sessionUsage.pageDesc")}</p>
      <p class="oc-settings__hint oc-session-usage__limit-hint">
        ${formatSessionUsageLimitNotice(t("settings.sessionUsage.limitHint"))}
      </p>

      <div class="oc-settings__card">
        ${s.loading
          ? html`<div class="oc-session-usage__empty">…</div>`
          : s.rows.length
            ? html`
                ${s.totals ? renderTotals(s.totals) : nothing}
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
  .oc-session-usage__limit-hint {
    margin-top: -4px;
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
