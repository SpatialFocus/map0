/**
 * Form fields as small Lit template functions. Every field renders the same
 * shell — label, control, optional help line — so the sections read as data
 * and the CSS has one thing to style. Values flow up through callbacks; the
 * element commits them to the config.
 */
import { html, nothing, type TemplateResult } from "lit";
import { numberOrUndefined } from "./state.js";

export interface FieldOptions {
  label: string;
  help?: string;
  placeholder?: string;
  disabled?: boolean;
}

const shell = (opts: FieldOptions, control: TemplateResult, inline = false): TemplateResult => html`
  <label class="field ${inline ? "inline" : ""}">
    ${inline ? control : nothing}
    <span class="label">${opts.label}</span>
    ${inline ? nothing : control}
    ${opts.help ? html`<small class="help">${opts.help}</small>` : nothing}
  </label>
`;

export function textField(
  opts: FieldOptions & { value: string | undefined; onInput: (value: string) => void; type?: "text" | "url" },
): TemplateResult {
  return shell(
    opts,
    html`<input
      type=${opts.type ?? "text"}
      .value=${opts.value ?? ""}
      placeholder=${opts.placeholder ?? ""}
      ?disabled=${opts.disabled}
      @input=${(e: Event) => opts.onInput((e.target as HTMLInputElement).value)}
    />`,
  );
}

/** commits on blur/Enter rather than every keystroke — for values that trigger a map reload */
export function textFieldLazy(
  opts: FieldOptions & { value: string | undefined; onCommit: (value: string) => void; type?: "text" | "url" },
): TemplateResult {
  const commit = (e: Event): void => opts.onCommit((e.target as HTMLInputElement).value);
  return shell(
    opts,
    html`<input
      type=${opts.type ?? "text"}
      .value=${opts.value ?? ""}
      placeholder=${opts.placeholder ?? ""}
      ?disabled=${opts.disabled}
      @change=${commit}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter") commit(e);
      }}
    />`,
  );
}

export function textareaField(
  opts: FieldOptions & { value: string | undefined; onCommit: (value: string) => void; rows?: number; mono?: boolean },
): TemplateResult {
  return shell(
    opts,
    html`<textarea
      class=${opts.mono ? "mono" : ""}
      rows=${opts.rows ?? 3}
      .value=${opts.value ?? ""}
      placeholder=${opts.placeholder ?? ""}
      ?disabled=${opts.disabled}
      @change=${(e: Event) => opts.onCommit((e.target as HTMLTextAreaElement).value)}
    ></textarea>`,
  );
}

export function numberField(
  opts: FieldOptions & {
    value: number | undefined;
    onInput: (value: number | undefined) => void;
    min?: number;
    max?: number;
    step?: number | "any";
  },
): TemplateResult {
  return shell(
    opts,
    html`<input
      type="number"
      .value=${opts.value === undefined ? "" : String(opts.value)}
      min=${opts.min ?? nothing}
      max=${opts.max ?? nothing}
      step=${opts.step ?? "any"}
      placeholder=${opts.placeholder ?? ""}
      ?disabled=${opts.disabled}
      @change=${(e: Event) => opts.onInput(numberOrUndefined((e.target as HTMLInputElement).value))}
    />`,
  );
}

export function rangeField(
  opts: FieldOptions & {
    value: number;
    onInput: (value: number) => void;
    min: number;
    max: number;
    step: number;
    format?: (value: number) => string;
  },
): TemplateResult {
  const shown = opts.format ? opts.format(opts.value) : String(opts.value);
  return shell(
    { ...opts, label: `${opts.label} · ${shown}` },
    html`<input
      type="range"
      .value=${String(opts.value)}
      min=${opts.min}
      max=${opts.max}
      step=${opts.step}
      ?disabled=${opts.disabled}
      @input=${(e: Event) => opts.onInput(Number((e.target as HTMLInputElement).value))}
    />`,
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function selectField(
  opts: FieldOptions & {
    value: string | undefined;
    options: SelectOption[];
    onChange: (value: string) => void;
    /** label of the "not set" option — omitted: the field always has a value */
    emptyLabel?: string;
  },
): TemplateResult {
  return shell(
    opts,
    html`<select
      .value=${opts.value ?? ""}
      ?disabled=${opts.disabled}
      @change=${(e: Event) => opts.onChange((e.target as HTMLSelectElement).value)}
    >
      ${opts.emptyLabel !== undefined ? html`<option value="">${opts.emptyLabel}</option>` : nothing}
      ${opts.options.map((o) => html`<option value=${o.value} ?selected=${o.value === opts.value}>${o.label}</option>`)}
    </select>`,
  );
}

export function checkField(
  opts: FieldOptions & { checked: boolean; onChange: (checked: boolean) => void },
): TemplateResult {
  return shell(
    opts,
    html`<input
      type="checkbox"
      .checked=${opts.checked}
      ?disabled=${opts.disabled}
      @change=${(e: Event) => opts.onChange((e.target as HTMLInputElement).checked)}
    />`,
    true,
  );
}

/** a colour input beside a text input — hex in, hex out, empty allowed */
export function colorField(
  opts: FieldOptions & { value: string | undefined; onInput: (value: string) => void },
): TemplateResult {
  const hex = /^#[0-9a-f]{6}$/i.test(opts.value ?? "") ? opts.value! : "#0e7490";
  return shell(
    opts,
    html`<span class="color-row">
      <input
        type="color"
        .value=${hex}
        ?disabled=${opts.disabled}
        @input=${(e: Event) => opts.onInput((e.target as HTMLInputElement).value)}
      />
      <input
        type="text"
        .value=${opts.value ?? ""}
        placeholder=${opts.placeholder ?? "#0e7490"}
        ?disabled=${opts.disabled}
        @change=${(e: Event) => opts.onInput((e.target as HTMLInputElement).value.trim())}
      />
    </span>`,
  );
}

/** a set of checkboxes for an enum array (print formats, sheet elements …) */
export function checkGroup(
  opts: FieldOptions & {
    value: readonly string[];
    options: SelectOption[];
    onChange: (value: string[]) => void;
  },
): TemplateResult {
  const toggle = (v: string, on: boolean): void => {
    const set = new Set(opts.value);
    if (on) set.add(v);
    else set.delete(v);
    opts.onChange(opts.options.map((o) => o.value).filter((x) => set.has(x)));
  };
  return html`
    <fieldset class="field group">
      <legend class="label">${opts.label}</legend>
      <div class="checks">
        ${opts.options.map(
          (o) => html`<label class="check">
            <input
              type="checkbox"
              .checked=${opts.value.includes(o.value)}
              @change=${(e: Event) => toggle(o.value, (e.target as HTMLInputElement).checked)}
            />
            <span>${o.label}</span>
          </label>`,
        )}
      </div>
      ${opts.help ? html`<small class="help">${opts.help}</small>` : nothing}
    </fieldset>
  `;
}

/** two-state chooser rendered as segmented buttons (a radio group) */
export function segmented(
  opts: { value: string; options: SelectOption[]; onChange: (value: string) => void; label?: string },
): TemplateResult {
  return html`
    <div class="segmented" role="radiogroup" aria-label=${opts.label ?? nothing}>
      ${opts.options.map(
        (o) => html`<button
          type="button"
          role="radio"
          aria-checked=${o.value === opts.value ? "true" : "false"}
          ?data-active=${o.value === opts.value}
          @click=${() => opts.onChange(o.value)}
        >
          ${o.label}
        </button>`,
      )}
    </div>
  `;
}

export const section = (title: string, body: TemplateResult, intro?: string): TemplateResult => html`
  <section class="block">
    <h3>${title}</h3>
    ${intro ? html`<p class="intro">${intro}</p>` : nothing}
    ${body}
  </section>
`;
