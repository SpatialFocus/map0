import { css } from "lit";

/**
 * The configurator's own styles. Tokens are host-overridable (`--map0c-*`),
 * the dark set switches on the `theme` attribute, and the three-column shell
 * collapses by the element's own width — a container query, like the viewer.
 */
export const configuratorStyles = css`
  :host {
    --map0c-bg: #ffffff;
    --map0c-surface: #f6f7f9;
    --map0c-fg: #17202a;
    --map0c-muted: #5b6774;
    --map0c-border: rgba(15, 23, 42, 0.12);
    --map0c-accent: #0e7490;
    --map0c-accent-fg: #ffffff;
    --map0c-danger: #b91c1c;
    --map0c-warn: #a16207;
    --map0c-ok: #15803d;
    --map0c-radius: 10px;
    --map0c-font:
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      "Helvetica Neue",
      sans-serif;
    --map0c-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --map0c-height: 640px;

    display: block;
    container-type: inline-size;
    color: var(--map0c-fg);
    font-family: var(--map0c-font);
    font-size: 13.5px;
    line-height: 1.45;
  }
  :host([theme="dark"]) {
    --map0c-bg: #1c2127;
    --map0c-surface: #14181d;
    --map0c-fg: #e8eaee;
    --map0c-muted: #9aa4b1;
    --map0c-border: rgba(255, 255, 255, 0.12);
    --map0c-accent: #22b8cf;
    --map0c-accent-fg: #0b1220;
    --map0c-danger: #f87171;
    --map0c-warn: #facc15;
    --map0c-ok: #4ade80;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* ------------------------------- shell ------------------------------- */

  .shell {
    display: grid;
    grid-template-columns: 168px minmax(0, 440px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .sections {
    display: grid;
    gap: 4px;
    position: sticky;
    top: 80px;
  }
  .sections button {
    all: unset;
    display: block;
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    color: var(--map0c-muted);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .sections button:hover {
    background: var(--map0c-surface);
    color: var(--map0c-fg);
  }
  .sections button[aria-current="true"] {
    background: color-mix(in srgb, var(--map0c-accent) 14%, transparent);
    color: var(--map0c-accent);
    font-weight: 600;
  }
  .sections button:focus-visible {
    outline: 2px solid var(--map0c-accent);
    outline-offset: 1px;
  }
  .sections .count {
    float: right;
    font-size: 11px;
    opacity: 0.7;
  }

  .form {
    min-width: 0;
    display: grid;
    gap: 14px;
    align-content: start;
  }

  .preview {
    min-width: 0;
    position: sticky;
    top: 80px;
    display: grid;
    gap: 10px;
  }
  map0-viewer {
    display: block;
    height: var(--map0c-height);
    border-radius: var(--map0c-radius);
    border: 1px solid var(--map0c-border);
  }

  @container (max-width: 1100px) {
    .shell {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .sections {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .sections button {
      width: auto;
    }
  }
  @container (max-width: 760px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }
    .preview {
      position: static;
    }
  }


  /* ------------------------------- blocks ------------------------------- */

  .block {
    background: var(--map0c-bg);
    border: 1px solid var(--map0c-border);
    border-radius: var(--map0c-radius);
    padding: 14px 16px 16px;
    display: grid;
    gap: 10px;
  }
  .block h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .block .intro,
  .empty {
    margin: -4px 0 0;
    color: var(--map0c-muted);
    font-size: 12.5px;
  }
  .empty {
    margin: 0;
    padding: 10px;
    border: 1px dashed var(--map0c-border);
    border-radius: 8px;
    text-align: center;
  }

  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .row3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
  }

  /* ------------------------------- fields ------------------------------- */

  .field {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .field.inline {
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 8px;
  }
  .field.inline .help {
    grid-column: 2;
  }
  .field .label,
  legend.label {
    font-size: 12px;
    font-weight: 600;
    color: var(--map0c-muted);
  }
  .field.inline .label {
    color: var(--map0c-fg);
    font-weight: 500;
    font-size: 13px;
  }
  .help {
    color: var(--map0c-muted);
    font-size: 11.5px;
    line-height: 1.4;
  }
  fieldset.field {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  input:not([type="checkbox"]):not([type="range"]):not([type="color"]),
  select,
  textarea {
    width: 100%;
    min-width: 0;
    font: inherit;
    font-size: 13px;
    color: var(--map0c-fg);
    background: var(--map0c-bg);
    border: 1px solid var(--map0c-border);
    border-radius: 7px;
    padding: 6px 9px;
  }
  textarea {
    resize: vertical;
    line-height: 1.4;
  }
  textarea.mono,
  .mono {
    font-family: var(--map0c-mono);
    font-size: 12px;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--map0c-accent);
    outline-offset: -1px;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--map0c-accent);
  }
  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--map0c-accent);
  }
  .color-row {
    display: grid;
    grid-template-columns: 40px 1fr;
    gap: 8px;
    align-items: center;
  }
  input[type="color"] {
    width: 40px;
    height: 32px;
    padding: 2px;
    border: 1px solid var(--map0c-border);
    border-radius: 7px;
    background: var(--map0c-bg);
  }

  /* ------------------------------- buttons ------------------------------- */

  .btn {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 11px;
    border-radius: 7px;
    border: 1px solid var(--map0c-border);
    background: var(--map0c-bg);
    color: var(--map0c-fg);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover {
    border-color: var(--map0c-accent);
    color: var(--map0c-accent);
  }
  .btn:focus-visible {
    outline: 2px solid var(--map0c-accent);
    outline-offset: 1px;
  }
  .btn[disabled] {
    opacity: 0.45;
    cursor: default;
    pointer-events: none;
  }
  .btn.primary {
    background: var(--map0c-accent);
    border-color: transparent;
    color: var(--map0c-accent-fg);
  }
  .btn.primary:hover {
    background: color-mix(in srgb, var(--map0c-accent) 85%, #000);
    color: var(--map0c-accent-fg);
  }
  .btn.danger:hover {
    border-color: var(--map0c-danger);
    color: var(--map0c-danger);
  }
  .btn.small {
    padding: 3px 8px;
    font-size: 12px;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .toolbar .spacer {
    flex: 1;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .segmented {
    display: inline-flex;
    border: 1px solid var(--map0c-border);
    border-radius: 7px;
    overflow: hidden;
  }
  .segmented button {
    all: unset;
    padding: 5px 10px;
    font: inherit;
    font-size: 12.5px;
    color: var(--map0c-muted);
    cursor: pointer;
  }
  .segmented button + button {
    border-left: 1px solid var(--map0c-border);
  }
  .segmented button[data-active] {
    background: color-mix(in srgb, var(--map0c-accent) 14%, transparent);
    color: var(--map0c-accent);
    font-weight: 600;
  }

  /* ------------------------------- lists ------------------------------- */

  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--map0c-border);
    border-radius: 8px;
    overflow: hidden;
    max-height: 320px;
    overflow-y: auto;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    padding-left: calc(10px + var(--depth, 0) * 16px);
    cursor: pointer;
    border-top: 1px solid var(--map0c-border);
  }
  .node:first-child {
    border-top: 0;
  }
  .node:hover {
    background: var(--map0c-surface);
  }
  .node.selected {
    background: color-mix(in srgb, var(--map0c-accent) 12%, transparent);
  }
  .node .grip {
    flex: none;
    color: var(--map0c-muted);
    cursor: grab;
    font-size: 13px;
    letter-spacing: -2px;
    user-select: none;
  }
  .node[data-dragging] {
    opacity: 0.45;
  }
  .node[data-drop="before"] {
    box-shadow: inset 0 3px 0 var(--map0c-accent);
  }
  .node[data-drop="after"] {
    box-shadow: inset 0 -3px 0 var(--map0c-accent);
  }
  .node[data-drop="into"] {
    background: color-mix(in srgb, var(--map0c-accent) 24%, transparent);
  }
  .node .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: none;
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--map0c-accent);
    background: color-mix(in srgb, var(--map0c-accent) 12%, transparent);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .tag {
    flex: none;
    font-size: 11px;
    color: var(--map0c-muted);
  }

  .candidates {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--map0c-border);
    border-radius: 8px;
    max-height: 260px;
    overflow-y: auto;
  }
  .candidates li {
    border-top: 1px solid var(--map0c-border);
  }
  .candidates li:first-child {
    border-top: 0;
  }
  .candidates label {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    padding: 7px 10px;
    cursor: pointer;
    align-items: start;
  }
  .candidates label[data-off] {
    opacity: 0.5;
    cursor: default;
  }
  .candidates input {
    margin-top: 2px;
  }
  .candidates .sub {
    grid-column: 2;
    font-size: 11.5px;
    color: var(--map0c-muted);
  }

  .panel {
    border: 1px solid var(--map0c-border);
    border-radius: 8px;
    padding: 12px;
    display: grid;
    gap: 10px;
    background: var(--map0c-surface);
  }
  .panel form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  details {
    border-top: 1px solid var(--map0c-border);
    padding-top: 8px;
  }
  summary {
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--map0c-muted);
  }
  details[open] summary {
    margin-bottom: 8px;
  }

  /* ------------------------------- status ------------------------------- */

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .status {
    font-weight: 650;
    font-size: 13px;
  }
  .status.ok {
    color: var(--map0c-ok);
  }
  .status.bad {
    color: var(--map0c-danger);
  }
  .status.pending {
    color: var(--map0c-muted);
  }
  .problems {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 12.5px;
  }
  .problems li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
  }
  .problems .path {
    font-family: var(--map0c-mono);
    font-size: 11.5px;
  }
  .problems li.error .path {
    color: var(--map0c-danger);
  }
  .problems li.warning .path {
    color: var(--map0c-warn);
  }
  .problems .message {
    color: var(--map0c-muted);
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--map0c-danger);
    font-size: 12.5px;
    margin: 0;
    white-space: pre-line;
  }
  .note {
    color: var(--map0c-muted);
    font-size: 12px;
    margin: 0;
  }
  .toast {
    font-size: 12.5px;
    color: var(--map0c-ok);
    font-weight: 600;
  }
  a {
    color: var(--map0c-accent);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
`;
