/**
 * A small HTML template tag. Every interpolated value is escaped unless it is
 * already `Html`, so copy and form input can't inject markup by accident.
 */

export class Html {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/** Anything a template can interpolate. `false`, `null` and `undefined` render nothing. */
export type Fragment = Html | string | number | false | null | undefined | readonly Fragment[];

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function render(fragment: Fragment): string {
  if (fragment instanceof Html) return fragment.value;
  if (Array.isArray(fragment)) return fragment.map(render).join('');
  if (fragment === false || fragment === null || fragment === undefined) return '';
  return escapeHtml(String(fragment));
}

export function html(strings: TemplateStringsArray, ...values: readonly Fragment[]): Html {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}

/** Markup that is trusted as it is: generated SVG, or HTML built elsewhere. */
export function raw(markup: string): Html {
  return new Html(markup);
}

/**
 * Copy with inline code: text between backticks becomes <code>. Everything
 * else is escaped, so copy can stay plain strings.
 */
export function prose(text: string): Html {
  return raw(
    text
      .split('`')
      .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)))
      .join(''),
  );
}
