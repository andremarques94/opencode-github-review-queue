// GUI bundles cannot ship CSS, and the host only compiles the Tailwind utilities it uses itself.
// The host has no styling hook for its question docks, so these selectors follow its markup: recheck them after
// OpenCode updates. Applied only while a review picker is open (see picker-styles.ts).
export const reviewPickerStyles = `
[data-component="session-elicitation-dock"] > [data-component="dock-prompt"][data-kind="question"],
[data-component="session-question-dock"] > [data-component="dock-prompt"][data-kind="question"] {
  --question-prompt-max-height: min(42dvh, 380px);
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  max-block-size: min(42dvh, 380px);
}
[data-component="session-elicitation-dock"] [data-slot="elicitation-fields"],
[data-component="session-question-dock"] [data-slot="question-options"] {
  flex: 1 1 auto;
  min-block-size: 0;
  max-block-size: min(24dvh, 220px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: auto;
}
[data-component="session-question-dock"] [data-slot="question-details"],
[data-component="session-question-dock"] [data-slot="question-details-frame"] {
  max-block-size: min(12dvh, 96px);
  overscroll-behavior: contain;
}
[data-component="session-question-dock"] [data-slot="question-options"]::-webkit-scrollbar {
  display: block;
  width: 8px;
}
[data-component="session-elicitation-dock"] [data-slot="elicitation-field"] {
  flex-shrink: 0;
}
[data-component="session-question-dock"] [data-slot="question-options"] {
  gap: 2px;
}
[data-component="session-question-dock"] [data-slot="question-option"] {
  padding-block: 6px;
}
`

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
  gap: 2px;
  padding: 6px 8px 2px 6px;
  background: var(--background-base);
  font-size: 12px;
}
.grq-group-toggle {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 4px 4px 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.grq-group-toggle svg { flex-shrink: 0; color: var(--icon-base); transition: transform 120ms; }
.grq-group-toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
.grq-group-toggle:hover .grq-group-name { color: var(--text-strong); }
.grq-group-toggle:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
.grq-group-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-base);
  font-weight: var(--font-weight-medium);
}
.grq-group-owner { color: var(--text-weaker); font-weight: var(--font-weight-regular); }
.grq-group-count {
  flex-shrink: 0;
  min-width: 16px;
  margin-left: 4px;
  color: var(--text-weaker);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.grq-group-tools {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-md);
  background: var(--surface-inset-base);
}

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
.grq-row:has(.grq-row-main[aria-expanded="true"]) + .grq-row,
.grq-row + .grq-row:has(.grq-row-main[aria-expanded="true"]) { margin-top: 4px; }
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
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  column-gap: 4px;
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
/* The chevron sits before the title, like the repository header's, with the meta line under the title. */
.grq-row-main > svg { margin-top: 1px; color: var(--icon-base); transition: transform 120ms; }
.grq-row-main[aria-expanded="false"] > svg { transform: rotate(-90deg); }
.grq-row-main > :not(svg) { grid-column: 2; }
.grq-row-body > .grq-details { margin-left: 20px; }
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
.grq-details dd[data-copyable] { display: flex; align-items: flex-start; gap: 8px; }
.grq-details dd[data-copyable] > span { flex: 1; min-width: 0; }
.grq-detail-copy {
  flex-shrink: 0;
  padding: 2px 6px;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-weak);
  font: inherit;
  cursor: pointer;
}
.grq-detail-copy:hover { color: var(--text-strong); background: var(--surface-raised-base); }
.grq-detail-copy:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
.grq-row-actions { flex-shrink: 0; margin-top: -3px; }

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
.grq-review-state {
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-md);
  background: var(--surface-inset-base);
  color: var(--text-strong);
  font: inherit;
}
.grq-review-state:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }
.grq-preview-help { color: var(--text-weak); font-size: 12px; line-height: 18px; }
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
