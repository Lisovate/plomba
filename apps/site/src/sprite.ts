/** Build-time only: reads the Lucide icons the site uses into one inline SVG sprite. */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ICON_NAMES, iconId } from './icons.ts';

const require = createRequire(import.meta.url);

/** The drawing inside a Lucide SVG file, without its root element or licence comment. */
function iconBody(name: string): string {
  const svg = readFileSync(require.resolve(`lucide-static/icons/${name}.svg`), 'utf8');
  const start = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  const end = svg.lastIndexOf('</svg>');
  if (start === 0 || end < start) throw new Error(`Unexpected markup in the ${name} icon`);
  return svg.slice(start, end).replace(/\s*\n\s*/g, '');
}

export function buildIconSprite(): string {
  const symbols = ICON_NAMES.map(
    (name) => `<symbol id="${iconId(name)}" viewBox="0 0 24 24">${iconBody(name)}</symbol>`,
  );
  return `<svg class="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><!-- Icons: Lucide (https://lucide.dev), ISC licence -->${symbols.join('')}</svg>`;
}
