import { css } from "lit";

/** Design tokens + component styles. Everything themable via CSS custom properties (F12). */
export const componentStyles = css`
  :host {
    /* ---- design tokens (overridable from config or host CSS) ---- */
    --map0-primary: #0e7490;
    --map0-bg: #ffffff;
    --map0-fg: #1d2733;
    --map0-muted: #5b6774;
    --map0-border: rgba(15, 23, 42, 0.14);
    --map0-radius: 10px;
    --map0-radius-sm: 7px;
    --map0-shadow: 0 4px 18px rgba(15, 23, 42, 0.16);
    --map0-font:
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      "Helvetica Neue",
      sans-serif;

    display: block;
    position: relative;
    min-height: 320px;
    font-family: var(--map0-font);
    color: var(--map0-fg);
    overflow: hidden;
    border-radius: var(--map0-radius);
  }

  :host([data-theme="dark"]) {
    --map0-bg: #22262c;
    --map0-fg: #e8eaee;
    --map0-muted: #9aa4b1;
    --map0-border: rgba(255, 255, 255, 0.14);
    --map0-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
  }

  .stage {
    position: absolute;
    inset: 0;
    container-type: inline-size;
    container-name: map0;
  }

  .map {
    position: absolute;
    inset: 0;
    background: var(--map0-bg);
  }

  /* ------------------------------ panels ------------------------------- */

  .panel {
    position: absolute;
    z-index: 5;
    background: var(--map0-bg);
    color: var(--map0-fg);
    border-radius: var(--map0-radius);
    box-shadow: var(--map0-shadow);
    border: 1px solid var(--map0-border);
    font-size: 13px;
    line-height: 1.45;
  }

  .toc {
    top: 10px;
    right: 10px;
    width: 272px;
    max-height: calc(100% - 20px);
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    cursor: pointer;
    font-weight: 600;
    border-radius: inherit;
  }
  .panel-header:focus-visible {
    outline: 2px solid var(--map0-primary);
    outline-offset: -2px;
  }
  .panel-header svg {
    flex: none;
    color: var(--map0-primary);
  }
  .panel-header .chevron {
    margin-left: auto;
    color: var(--map0-muted);
    transition: transform 0.18s ease;
  }
  .toc[data-open] .panel-header .chevron {
    transform: rotate(180deg);
  }

  .panel-body {
    overflow: auto;
    padding: 2px 8px 10px;
    border-top: 1px solid var(--map0-border);
    overscroll-behavior: contain;
  }

  .group-header {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 4px 4px;
    font-weight: 600;
    font-size: 12px;
    color: var(--map0-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .group-header:focus-visible {
    outline: 2px solid var(--map0-primary);
    border-radius: 4px;
  }
  .group-header .chevron {
    margin-left: auto;
    transition: transform 0.18s ease;
  }
  .group[data-collapsed] .group-header .chevron {
    transform: rotate(-90deg);
  }
  .group[data-collapsed] .group-body {
    display: none;
  }
  .group .group-body {
    padding-left: 6px;
  }

  .layer-row {
    padding: 6px 4px;
    border-radius: var(--map0-radius-sm);
  }
  .layer-row:hover {
    background: color-mix(in srgb, var(--map0-primary) 7%, transparent);
  }
  .layer-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .layer-main label {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .layer-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .layer-main input[type="checkbox"] {
    accent-color: var(--map0-primary);
    width: 15px;
    height: 15px;
    flex: none;
    margin: 0;
  }

  .status-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .status-dot[data-status="loading"] {
    background: #eab308;
    animation: m0pulse 1.1s ease-in-out infinite;
  }
  .status-dot[data-status="error"] {
    background: #dc2626;
  }
  .status-dot[data-status="ready"] {
    display: none;
  }
  @keyframes m0pulse {
    50% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .status-dot[data-status="loading"] {
      animation: none;
    }
    .panel-header .chevron,
    .group-header .chevron {
      transition: none;
    }
  }

  .meta-link {
    flex: none;
    display: inline-flex;
    color: var(--map0-muted);
    border-radius: 4px;
  }
  .meta-link:hover,
  .meta-link:focus-visible {
    color: var(--map0-primary);
    outline: none;
  }

  .opacity-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 2px 0 25px;
  }
  .opacity-row input[type="range"] {
    flex: 1;
    accent-color: var(--map0-primary);
    height: 14px;
    margin: 0;
  }
  .opacity-value {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: var(--map0-muted);
    font-size: 11px;
    width: 34px;
    text-align: right;
  }

  .toc-empty {
    padding: 10px 6px;
    color: var(--map0-muted);
  }

  .layer-row[data-out-of-range] .layer-title {
    color: var(--map0-muted);
  }
  .zoom-hint {
    padding: 1px 2px 0 25px;
    font-size: 11px;
    color: var(--map0-muted);
    font-style: italic;
  }

  /* ------------------------------- legend ------------------------------- */

  .legend {
    width: 236px;
    max-height: 45%;
    display: flex;
    flex-direction: column;
  }
  .legend[data-pos="bottom-right"] {
    right: 10px;
    bottom: 32px;
  }
  .legend[data-pos="bottom-left"] {
    left: 10px;
    bottom: 76px;
  }
  .legend[data-pos="top-right"] {
    right: 10px;
    top: 10px;
  }
  .legend[data-pos="top-left"] {
    left: 56px;
    top: 10px;
  }
  .legend-layer {
    padding: 8px 4px 2px;
  }
  .legend-layer + .legend-layer {
    border-top: 1px solid var(--map0-border);
  }
  .legend-layer-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--map0-muted);
    margin-bottom: 4px;
  }
  .legend-image {
    display: block;
    max-width: 100%;
    background: #ffffff;
    border-radius: var(--map0-radius-sm);
    padding: 6px;
    box-sizing: border-box;
  }
  .legend-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    font-size: 12.5px;
  }
  .legend-entry-img {
    max-height: 20px;
  }
  .swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--swatch);
    border: 1px solid rgba(0, 0, 0, 0.18);
  }
  .swatch[data-shape="line"] {
    height: 3px;
    border-radius: 2px;
    border: none;
  }
  .swatch[data-shape="circle"] {
    border-radius: 50%;
  }

  /* -------------------------- basemap switcher -------------------------- */

  .basemaps {
    position: absolute;
    z-index: 5;
    left: 10px;
    bottom: 34px;
    display: flex;
    gap: 6px;
    padding: 5px;
    background: var(--map0-bg);
    border: 1px solid var(--map0-border);
    border-radius: calc(var(--map0-radius-sm) + 4px);
    box-shadow: var(--map0-shadow);
    max-width: calc(100% - 20px);
    overflow-x: auto;
  }
  .basemaps button {
    all: unset;
    box-sizing: border-box;
    padding: 5px 11px;
    border-radius: var(--map0-radius-sm);
    font-size: 12.5px;
    font-weight: 500;
    color: var(--map0-fg);
    cursor: pointer;
    white-space: nowrap;
  }
  .basemaps button:hover {
    background: color-mix(in srgb, var(--map0-primary) 10%, transparent);
  }
  .basemaps button:focus-visible {
    outline: 2px solid var(--map0-primary);
  }
  .basemaps button[data-active] {
    background: var(--map0-primary);
    color: #fff;
  }

  /* ------------------------------ popups ------------------------------- */

  .maplibregl-popup-content {
    font-family: var(--map0-font);
    background: var(--map0-bg);
    color: var(--map0-fg);
    border-radius: var(--map0-radius);
    box-shadow: var(--map0-shadow);
    padding: 12px 14px;
    max-height: 320px;
    overflow: auto;
  }
  .maplibregl-popup-close-button {
    font-size: 18px;
    padding: 2px 8px;
    color: var(--map0-muted);
  }
  :host([data-theme="dark"]) .maplibregl-popup-tip {
    border-top-color: var(--map0-bg);
    border-bottom-color: var(--map0-bg);
  }
  .m0-popup h4 {
    margin: 0 0 6px;
    font-size: 13px;
  }
  .m0-popup .m0-layer-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--map0-primary);
    margin: 0 0 4px;
  }
  .m0-popup section + section,
  .m0-popup details {
    margin-top: 8px;
    border-top: 1px solid var(--map0-border);
    padding-top: 8px;
  }
  .m0-popup details summary {
    cursor: pointer;
    color: var(--map0-primary);
    font-size: 12px;
    font-weight: 600;
    user-select: none;
  }
  .m0-popup details summary:focus-visible {
    outline: 2px solid var(--map0-primary);
    border-radius: 4px;
  }
  .m0-popup .m0-feature + .m0-feature {
    margin-top: 8px;
    border-top: 1px dashed var(--map0-border);
    padding-top: 8px;
  }
  table.m0-fields {
    border-collapse: collapse;
    width: 100%;
    font-size: 12.5px;
  }
  table.m0-fields th {
    text-align: left;
    color: var(--map0-muted);
    font-weight: 500;
    padding: 2px 10px 2px 0;
    vertical-align: top;
    white-space: nowrap;
  }
  table.m0-fields td {
    padding: 2px 0;
    word-break: break-word;
  }

  /* ---------------------------- add-layer dialog ------------------------ */

  .icon-btn {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--map0-muted);
  }
  .icon-btn:hover,
  .icon-btn:focus-visible {
    color: var(--map0-primary);
    background: color-mix(in srgb, var(--map0-primary) 10%, transparent);
    outline: none;
  }
  .add-btn {
    margin-left: auto;
  }
  .panel-header:has(.add-btn) .chevron {
    margin-left: 0;
  }
  .remove-btn {
    width: 20px;
    height: 20px;
    font-size: 12px;
  }
  .toc-extras {
    margin-top: 6px;
    border-top: 1px solid var(--map0-border);
  }
  .group-label {
    padding: 8px 4px 4px;
    font-weight: 600;
    font-size: 12px;
    color: var(--map0-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dialog-backdrop {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(15, 23, 42, 0.45);
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .dialog {
    background: var(--map0-bg);
    color: var(--map0-fg);
    border-radius: var(--map0-radius);
    box-shadow: var(--map0-shadow);
    width: min(440px, 100%);
    max-height: 90%;
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    font-weight: 600;
    border-bottom: 1px solid var(--map0-border);
  }
  .dialog-body {
    padding: 12px 14px;
    overflow: auto;
  }
  .dialog-intro {
    margin: 0 0 10px;
    color: var(--map0-muted);
  }
  .dialog-note {
    color: var(--map0-muted);
    margin: 8px 0 0;
  }
  .dialog-error {
    color: #dc2626;
    margin: 8px 0 0;
  }
  .service-toggle {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--map0-border);
    border-radius: var(--map0-radius-sm);
    margin-bottom: 10px;
  }
  .service-toggle button {
    all: unset;
    padding: 4px 12px;
    border-radius: calc(var(--map0-radius-sm) - 2px);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    color: var(--map0-muted);
  }
  .service-toggle button[data-active] {
    background: var(--map0-primary);
    color: #fff;
  }
  .service-toggle button:focus-visible {
    outline: 2px solid var(--map0-primary);
  }

  .url-row {
    display: flex;
    gap: 8px;
  }
  .url-row input,
  .list-filter {
    flex: 1;
    box-sizing: border-box;
    padding: 7px 10px;
    border: 1px solid var(--map0-border);
    border-radius: var(--map0-radius-sm);
    background: transparent;
    color: var(--map0-fg);
    font: inherit;
  }
  .url-row input:focus-visible,
  .list-filter:focus-visible {
    outline: 2px solid var(--map0-primary);
    outline-offset: -1px;
  }
  .list-filter {
    width: 100%;
    margin-top: 10px;
  }
  .btn {
    all: unset;
    box-sizing: border-box;
    padding: 7px 14px;
    border-radius: var(--map0-radius-sm);
    border: 1px solid var(--map0-border);
    cursor: pointer;
    font-weight: 500;
  }
  .btn:focus-visible {
    outline: 2px solid var(--map0-primary);
  }
  .btn-primary {
    background: var(--map0-primary);
    border-color: var(--map0-primary);
    color: #fff;
  }
  .btn[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .url-row button {
    all: unset;
    padding: 7px 12px;
    border-radius: var(--map0-radius-sm);
    background: var(--map0-primary);
    color: #fff;
    cursor: pointer;
    font-weight: 500;
  }
  .url-row button:focus-visible {
    outline: 2px solid var(--map0-fg);
  }
  .add-list {
    margin-top: 10px;
    border: 1px solid var(--map0-border);
    border-radius: var(--map0-radius-sm);
    max-height: 260px;
    overflow: auto;
  }
  .add-row {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    padding: 7px 10px;
    cursor: pointer;
  }
  .add-row:hover {
    background: color-mix(in srgb, var(--map0-primary) 7%, transparent);
  }
  .add-row + .add-row {
    border-top: 1px solid var(--map0-border);
  }
  .add-row input {
    accent-color: var(--map0-primary);
    margin: 2px 0 0;
  }
  .add-row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .add-row-warn {
    font-size: 11px;
    color: #b45309;
  }
  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--map0-border);
  }
  .form-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .form-row > span {
    flex: none;
    width: 90px;
    color: var(--map0-muted);
  }
  .form-row input,
  .form-row select {
    flex: 1;
    box-sizing: border-box;
    padding: 7px 10px;
    border: 1px solid var(--map0-border);
    border-radius: var(--map0-radius-sm);
    background: var(--map0-bg);
    color: var(--map0-fg);
    font: inherit;
  }
  .form-row input:focus-visible,
  .form-row select:focus-visible {
    outline: 2px solid var(--map0-primary);
    outline-offset: -1px;
  }
  .form-check {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .form-check input {
    accent-color: var(--map0-primary);
  }

  /* ------------------------------- notices ------------------------------ */

  .notices {
    position: absolute;
    z-index: 30;
    left: 50%;
    transform: translateX(-50%);
    bottom: 34px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    pointer-events: none;
    max-width: min(92%, 480px);
  }
  .notice {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--map0-bg);
    color: var(--map0-fg);
    border: 1px solid var(--map0-border);
    border-left: 3px solid var(--map0-primary);
    border-radius: var(--map0-radius-sm);
    box-shadow: var(--map0-shadow);
    padding: 8px 6px 8px 12px;
    font-size: 12.5px;
    animation: m0slide 0.18s ease;
  }
  .notice[data-kind="error"] {
    border-left-color: #dc2626;
  }
  @keyframes m0slide {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .notice {
      animation: none;
    }
  }

  /* --------------------------- error / loading -------------------------- */

  .error-panel {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    background: var(--map0-bg);
    padding: 20px;
  }
  .error-card {
    max-width: 560px;
    border: 1px solid #dc2626;
    border-radius: var(--map0-radius);
    padding: 16px 20px;
    background: color-mix(in srgb, #dc2626 4%, var(--map0-bg));
  }
  .error-card h3 {
    margin: 0 0 6px;
    font-size: 15px;
    color: #dc2626;
  }
  .error-card p {
    margin: 0 0 10px;
    color: var(--map0-muted);
    font-size: 13px;
  }
  .error-card ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
  }
  .error-card code {
    background: color-mix(in srgb, var(--map0-fg) 8%, transparent);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 12px;
  }

  .loading {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-items: center;
    background: var(--map0-bg);
    transition: opacity 0.25s ease;
    pointer-events: none;
  }
  .loading[data-done] {
    opacity: 0;
  }
  .spinner {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 3px solid color-mix(in srgb, var(--map0-primary) 25%, transparent);
    border-top-color: var(--map0-primary);
    animation: m0spin 0.9s linear infinite;
  }
  @keyframes m0spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2.5s;
    }
  }

  /* ------------------------- responsive (container) --------------------- */

  @container map0 (max-width: 480px) {
    .toc {
      left: 10px;
      right: 10px;
      width: auto;
      max-height: 55%;
    }
    .basemaps {
      bottom: 28px;
    }
    .legend {
      left: 10px;
      right: 10px;
      width: auto;
      max-height: 40%;
    }
  }

  /* light touch on MapLibre ctrl corners so panels don't collide */
  .maplibregl-ctrl-top-left {
    z-index: 4;
  }
`;
