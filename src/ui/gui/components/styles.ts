// GUI bundles cannot ship CSS, and the host only compiles the Tailwind utilities it uses itself.
const badgeStyles = `
.grq-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-xs);
  font-size: 10px;
  line-height: 14px;
}
.grq-badge-review { border-color: var(--border-interactive-base, var(--border-weak-base)); color: var(--text-interactive-base, var(--text-base)); }
`

export const panelStyles = `${badgeStyles}
.grq {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--background-base);
  color: var(--text-base);
  font-family: var(--font-family-sans);
  font-size: 13px;
}

.grq-header {
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border-weaker-base);
}
.grq-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.grq-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-strong);
  font-weight: var(--font-weight-medium);
}
.grq-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-raised-base);
  color: var(--text-weak);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.grq-tools { display: flex; align-items: center; gap: 4px; }
.grq-status {
  margin-top: 2px;
  color: var(--text-weak);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grq-status-stale { color: var(--icon-warning-base); }
.grq-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-interactive-base, var(--text-base));
  font: inherit;
  cursor: pointer;
}
.grq-link:hover { text-decoration: underline; }
.grq-link:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }

.grq-segment {
  display: inline-flex;
  min-width: 0;
  margin: 0;
  padding: 2px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--surface-inset-base);
}
.grq-segment-button {
  padding: 1px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: inherit;
  color: var(--text-weak);
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
}
.grq-segment-button:hover:not(:disabled) { color: var(--text-strong); }
.grq-segment-button[aria-pressed="true"] {
  background: var(--surface-raised-stronger-non-alpha);
  color: var(--text-strong);
  box-shadow: 0 0 0 1px var(--border-weak-base);
}
.grq-segment-button:disabled { opacity: 0.4; cursor: default; }
.grq-segment-button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }

.grq-banner {
  margin: 8px 12px 0;
  padding: 8px 10px;
  border: 1px solid var(--border-warning-base);
  border-radius: var(--radius-md);
  background: var(--surface-warning-weak);
  font-size: 12px;
  line-height: 16px;
}

.grq-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 12px;
}
.grq-group {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px 12px 4px 6px;
  border: 0;
  background: var(--background-base);
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.grq-group svg { flex-shrink: 0; color: var(--icon-weak-base); transition: transform 120ms; }
.grq-group[aria-expanded="false"] svg { transform: rotate(-90deg); }
.grq-group:hover .grq-group-name { color: var(--text-strong); }
.grq-group:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; }
.grq-group-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-base);
  font-weight: var(--font-weight-medium);
}
.grq-group-owner { color: var(--text-weaker); font-weight: var(--font-weight-regular); }
.grq-group-count { margin-left: auto; color: var(--text-weaker); font-variant-numeric: tabular-nums; }

.grq-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin: 0 4px;
  padding: 7px 4px 7px 8px;
  border-radius: var(--radius-md);
}
.grq-row:hover,
.grq-row:has([aria-expanded="true"]) { background: var(--surface-raised-base-hover); }
.grq-row:has(.grq-row-main:focus-visible) { box-shadow: inset 0 0 0 2px var(--border-focus); }
/* Open rows share a background, so without a gap two of them read as one card. */
.grq-row:has(> [aria-expanded="true"]) + .grq-row,
.grq-row + .grq-row:has(> [aria-expanded="true"]) { margin-top: 4px; }
.grq-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--icon-interactive-base);
}
.grq-dot[data-hidden] { visibility: hidden; }
.grq-row-body { flex: 1; min-width: 0; }
.grq-row-main {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
}
.grq-row-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--text-strong);
  font-size: 13px;
  font-weight: var(--font-weight-medium);
  line-height: 18px;
}
.grq-row-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  overflow: hidden;
  white-space: nowrap;
  color: var(--text-weak);
  font-size: 12px;
  line-height: 16px;
}
.grq-row-meta > span { overflow: hidden; text-overflow: ellipsis; }
.grq-number { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.grq-sep { flex-shrink: 0; color: var(--text-weaker); }
.grq-team { color: var(--text-weaker); }
.grq-author { color: var(--text-base); font-weight: var(--font-weight-medium); }
.grq-number[data-stale] { color: var(--icon-warning-base); }
.grq-mark { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.grq-mark[data-tone="success"] { color: var(--icon-success-base); }
.grq-mark[data-tone="error"] { color: var(--icon-critical-base); }
.grq-mark[data-tone="warning"] { color: var(--icon-warning-base); }
.grq-disclosure {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-top: -3px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--icon-weak-base);
  cursor: pointer;
}
.grq-disclosure:hover { background: var(--surface-raised-base-hover); color: var(--text-strong); }
.grq-disclosure:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
.grq-disclosure svg { transition: transform 120ms; }
.grq-disclosure[aria-expanded="false"] svg { transform: rotate(-90deg); }
.grq-details {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 12px;
  margin: 8px 0 2px;
  font-size: 12px;
  line-height: 16px;
}
.grq-details dt { color: var(--text-weaker); white-space: nowrap; }
.grq-details dd { margin: 0; min-width: 0; color: var(--text-base); overflow-wrap: anywhere; }
.grq-details dd[data-tone="success"] { color: var(--icon-success-base); }
.grq-details dd[data-tone="error"] { color: var(--icon-critical-base); }
.grq-details dd[data-tone="warning"] { color: var(--icon-warning-base); }
.grq-row-actions { flex-shrink: 0; margin-top: -3px; opacity: 0; transition: opacity 120ms; }
.grq-row:hover .grq-row-actions,
.grq-row:focus-within .grq-row-actions,
.grq-row-actions:has([aria-expanded="true"]) { opacity: 1; }
@media (hover: none) { .grq-row-actions { opacity: 1; } }

.grq-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--text-weak);
  text-align: center;
  line-height: 18px;
}
.grq-empty-icon { color: var(--icon-weak-base); }
`

export const dialogStyles = `${badgeStyles}
.grq-preview { display: flex; flex-direction: column; gap: 16px; font-size: 13px; }
.grq-preview-meta { display: flex; align-items: center; gap: 8px; color: var(--text-weak); }
.grq-preview-section { display: flex; flex-direction: column; gap: 8px; }
.grq-preview-heading {
  margin: 0;
  color: var(--text-weak);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.grq-preview-comment {
  padding: 8px 10px;
  border: 1px solid var(--border-weaker-base);
  border-radius: var(--radius-md);
  background: var(--surface-inset-base);
}
.grq-preview-location {
  margin-bottom: 4px;
  color: var(--text-weak);
  font-family: var(--font-family-mono);
  font-size: 12px;
}
.grq-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 220px;
  padding: 8px 10px;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  background: var(--surface-inset-base);
  color: var(--text-strong);
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 18px;
  resize: vertical;
}
.grq-textarea:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
`

const actionStyles = `
.grq-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.grq-muted { color: var(--text-weak); font-size: 12px; line-height: 16px; }
`

export const progressStyles = `${actionStyles}
/* The host's popover already insets its content as far as its heading. */
.grq-progress { display: flex; flex-direction: column; gap: 10px; min-width: 240px; padding: 0 0 6px; font-size: 13px; }
.grq-progress-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border-weaker-base);
}
`

export const findingStyles = `${badgeStyles}${actionStyles}
.grq-findings {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--background-base);
  color: var(--text-base);
  font-family: var(--font-family-sans);
  font-size: 13px;
}
.grq-findings-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border-weaker-base);
}
.grq-findings-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.grq-findings-title { min-width: 0; color: var(--text-strong); font-weight: var(--font-weight-medium); }
.grq-findings-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 8px 12px;
}
.grq-finding {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border-weaker-base);
  border-radius: var(--radius-md);
  background: var(--surface-inset-base);
}
.grq-finding[data-decision="drop"] { opacity: 0.6; }
.grq-finding-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; color: var(--text-weak); font-size: 12px; }
.grq-finding-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-base);
  font-family: var(--font-family-mono);
}
.grq-badge-keep { border-color: var(--border-success-base, var(--border-weak-base)); color: var(--text-success-base, var(--text-base)); }
.grq-badge-drop { color: var(--text-weaker); }
`
