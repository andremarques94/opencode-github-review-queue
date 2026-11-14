// GUI bundles cannot ship CSS, and the host only compiles the Tailwind utilities it uses itself.
export const panelStyles = `
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
  align-items: baseline;
  gap: 6px;
  padding: 10px 12px 4px;
  background: var(--background-base);
  font-size: 12px;
}
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
.grq-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--icon-interactive-base);
}
.grq-dot[data-hidden] { visibility: hidden; }
.grq-row-main {
  flex: 1;
  min-width: 0;
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
.grq-badge {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid var(--border-weak-base);
  border-radius: var(--radius-xs);
  font-size: 10px;
  line-height: 14px;
}
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
