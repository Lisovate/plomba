/**
 * Generates the static site: every page to <path>/index.html, the assets, the
 * images, a sitemap, and what the server needs to render its own pages.
 *
 *   node src/build.ts                         (npm run build --workspace @plomba/site)
 *   SITE_URL=https://example.com node src/build.ts
 */

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleAssets } from './assets.ts';
import { SITE } from './config.ts';
import { escapeHtml } from './html.ts';
import { type Page, type RenderContext, renderDocument } from './layout.ts';
import { DEFAULT_DIST_DIR, outputPaths } from './output.ts';
import { notFound, PAGES } from './pages/index.ts';
import { buildIconSprite } from './sprite.ts';

const PUBLIC_SOURCE = fileURLToPath(new URL('../public', import.meta.url));
/** The app's icons are the site's too. */
const APP_ICONS = fileURLToPath(new URL('../../web/public/icons', import.meta.url));

export interface BuildOptions {
  readonly distDir: string;
  /** The origin the site is published at, for canonical URLs, link previews and the sitemap. */
  readonly origin: string;
}

export interface BuildResult {
  readonly context: RenderContext;
  /** The HTML files written, relative to the public folder. */
  readonly files: readonly string[];
}

const pageFile = (page: Page) => join(page.path, 'index.html');

async function write(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

function sitemap(origin: string): string {
  const urls = PAGES.filter((page) => !page.noindex).map(
    (page) => `  <url><loc>${escapeHtml(new URL(page.path, origin).href)}</loc></url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

function robots(origin: string): string {
  return `User-agent: *
Disallow: /api/
Sitemap: ${new URL('/sitemap.xml', origin).href}
`;
}

export async function buildSite(options: BuildOptions): Promise<BuildResult> {
  const out = outputPaths(options.distDir);
  await rm(options.distDir, { recursive: true, force: true });
  await mkdir(out.publicDir, { recursive: true });

  await cp(PUBLIC_SOURCE, out.publicDir, { recursive: true });
  await cp(join(APP_ICONS, 'favicon.svg'), join(out.publicDir, 'favicon.svg'));
  await cp(join(APP_ICONS, 'apple-touch-icon.png'), join(out.publicDir, 'apple-touch-icon.png'));

  const assets = bundleAssets();
  await Promise.all(assets.files.map((file) => write(join(out.publicDir, file.path), file.data)));

  const context: RenderContext = {
    origin: options.origin,
    assets: assets.urls,
    sprite: buildIconSprite(),
  };
  await Promise.all(
    PAGES.map((page) => write(join(out.publicDir, pageFile(page)), renderDocument(page, context))),
  );
  await write(out.notFoundPage, renderDocument(notFound, context));
  await write(join(out.publicDir, 'sitemap.xml'), sitemap(options.origin));
  await write(join(out.publicDir, 'robots.txt'), robots(options.origin));
  await write(out.renderContext, `${JSON.stringify(context, null, 2)}\n`);

  return { context, files: PAGES.map(pageFile) };
}

if (import.meta.main) {
  const distDir = process.env.SITE_DIST_DIR ?? DEFAULT_DIST_DIR;
  const origin = process.env.SITE_URL ?? SITE.origin;
  const { files } = await buildSite({ distDir, origin });
  console.log(
    `Built ${files.length} pages for ${origin} into ${relative(process.cwd(), distDir) || '.'}`,
  );
}
