/**
 * Icons from Lucide (ISC licence). The build puts the ones listed here into an
 * inline SVG sprite on every page (see sprite.ts), and `icon()` references a
 * symbol from it, so rendering a page needs no files.
 */

import { type Html, html } from './html.ts';

export const ICON_NAMES = [
  'anchor',
  'archive',
  'arrow-right',
  'arrow-up-right',
  'book-open-check',
  'braces',
  'building-2',
  'check',
  'circle-alert',
  'circle-check',
  'circle-dashed',
  'circle-dot',
  'cloud',
  'container',
  'cpu',
  'crosshair',
  'database',
  'file-code',
  'file-text',
  'git-fork',
  'globe',
  'grid-3x3',
  'hash',
  'history',
  'list-checks',
  'lock',
  'mail',
  'mic',
  'receipt-text',
  'scale',
  'scan-text',
  'server',
  'shield-check',
  'ship',
  'smartphone',
  'stamp',
  'train-front',
  'truck',
  'video',
  'warehouse',
  'webhook',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The id of an icon's symbol in the sprite. */
export const iconId = (name: IconName): string => `i-${name}`;

/** A decorative icon; the text next to it carries the meaning. */
export function icon(name: IconName, className = 'icon'): Html {
  return html`<svg class="${className}" aria-hidden="true" focusable="false"><use href="#${iconId(name)}"></use></svg>`;
}
