/**
 * Build-time only: gathers the stylesheet, the browser script and the fonts
 * into one folder named after a hash of their contents, so a new build gets
 * new URLs and browsers can cache each build's files for good.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import type { AssetUrls } from './layout.ts';

const require = createRequire(import.meta.url);
const source = (path: string) => new URL(path, import.meta.url);

export interface AssetFile {
  /** Relative to the public folder. */
  readonly path: string;
  readonly data: Buffer;
}

export interface AssetBundle {
  readonly urls: AssetUrls;
  readonly files: readonly AssetFile[];
}

/** IBM Plex (SIL Open Font License), from Fontsource. The stylesheet points at these names. */
const FONTS = [
  {
    name: 'plex-sans-latin.woff2',
    from: '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2',
    preload: true,
  },
  {
    name: 'plex-sans-latin-ext.woff2',
    from: '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-ext-wght-normal.woff2',
    preload: false,
  },
  {
    name: 'plex-mono-latin-400.woff2',
    from: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
    preload: false,
  },
  {
    name: 'plex-mono-latin-500.woff2',
    from: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
    preload: false,
  },
] as const;

const FONT_LICENCES = [
  { name: 'OFL-ibm-plex-sans.txt', from: '@fontsource-variable/ibm-plex-sans/LICENSE' },
  { name: 'OFL-ibm-plex-mono.txt', from: '@fontsource/ibm-plex-mono/LICENSE' },
] as const;

/** The browser script, written in TypeScript and shipped with its types stripped. */
function browserScript(): Buffer {
  const code = readFileSync(source('./client/waitlist.ts'), 'utf8');
  const stripped = stripTypeScriptTypes(code, { mode: 'strip' }).replace(/[ \t]+$/gm, '');
  return Buffer.from(stripped);
}

export function bundleAssets(): AssetBundle {
  const files: AssetFile[] = [
    { path: 'site.css', data: readFileSync(source('./styles/site.css')) },
    { path: 'waitlist.js', data: browserScript() },
    ...FONTS.map((font) => ({
      path: `fonts/${font.name}`,
      data: readFileSync(require.resolve(font.from)),
    })),
    ...FONT_LICENCES.map((licence) => ({
      path: `fonts/${licence.name}`,
      data: readFileSync(require.resolve(licence.from)),
    })),
  ];

  const hash = createHash('sha256');
  for (const file of files) hash.update(file.path).update(file.data);
  const folder = `assets/${hash.digest('hex').slice(0, 12)}`;
  const url = (path: string) => `/${folder}/${path}`;

  return {
    urls: {
      stylesheet: url('site.css'),
      waitlistScript: url('waitlist.js'),
      preloadFonts: FONTS.filter((font) => font.preload).map((font) => url(`fonts/${font.name}`)),
    },
    files: files.map((file) => ({ ...file, path: `${folder}/${file.path}` })),
  };
}
