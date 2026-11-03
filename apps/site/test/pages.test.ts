import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeHtml, html, prose } from '../src/html.ts';
import { IMAGES } from '../src/images.ts';
import type { Page } from '../src/layout.ts';
import { PAGES } from '../src/pages/index.ts';
import { TEST_ORIGIN, useBuiltSite } from './built-site.ts';

const site = useBuiltSite();

const fileOf = (path: string) => join(path, 'index.html');

/** Attribute values of every match of `pattern`, whose first group is the value. */
const all = (markup: string, pattern: RegExp): string[] =>
  [...markup.matchAll(pattern)].map((m) => m[1] ?? '');

const meta = (markup: string, key: string): string | undefined =>
  new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(markup)?.[1];

const decodeEntities = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('every page', () => {
  it.each(PAGES.map((page) => [page.path, page] as [string, Page]))(
    '%s builds with a title, a description and link previews',
    async (path, page) => {
      const markup = await site().read(fileOf(path));
      const title = /<title>([^<]+)<\/title>/.exec(markup)?.[1];
      expect(title && decodeEntities(title)).toBe(page.title);
      expect(page.title.length).toBeGreaterThan(10);

      const description = meta(markup, 'description');
      expect(description && decodeEntities(description)).toBe(page.description);
      // Long enough to say something, short enough not to be cut off in search results.
      expect(page.description.length).toBeGreaterThanOrEqual(50);
      expect(page.description.length).toBeLessThanOrEqual(170);

      const url = new URL(path, TEST_ORIGIN).href;
      expect(markup).toContain(`<link rel="canonical" href="${url}">`);
      expect(meta(markup, 'og:title')).toBe(escapeHtml(page.title));
      expect(meta(markup, 'og:description')).toBe(escapeHtml(page.description));
      expect(meta(markup, 'og:url')).toBe(url);
      expect(meta(markup, 'og:image')).toBe(new URL(IMAGES.social.src, TEST_ORIGIN).href);
      expect(markup).toContain('<html lang="en-GB">');
    },
  );

  it('has exactly one main heading', async () => {
    for (const page of PAGES) {
      const markup = await site().read(fileOf(page.path));
      expect(markup.match(/<h1[\s>]/g), page.path).toHaveLength(1);
    }
  });

  it('has its own title and description', () => {
    expect(new Set(PAGES.map((p) => p.title)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.description)).size).toBe(PAGES.length);
  });

  it('works under the content security policy: no inline scripts or styles', async () => {
    for (const page of PAGES) {
      const markup = await site().read(fileOf(page.path));
      expect(markup, page.path).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      expect(markup, page.path).not.toMatch(/\sstyle="/);
      expect(markup, page.path).not.toMatch(/\son[a-z]+="/);
    }
  });

  it('links only to pages and files that exist, and to anchors that are there', async () => {
    const built = new Map<string, string>();
    for (const page of PAGES) built.set(page.path, await site().read(fileOf(page.path)));

    for (const [from, markup] of built) {
      for (const href of all(markup, /\shref="(\/[^"]*)"/g)) {
        const [path = '', anchor] = decodeEntities(href).split('#');
        const target = built.get(path);
        if (target === undefined) {
          expect(await exists(join(site().publicDir, path)), `${from} links to ${href}`).toBe(true);
          continue;
        }
        if (anchor) expect(target, `${from} links to ${href}`).toContain(`id="${anchor}"`);
      }
    }
  });

  it('points every icon at a symbol in the sprite', async () => {
    for (const page of PAGES) {
      const markup = await site().read(fileOf(page.path));
      for (const id of new Set(all(markup, /<use href="#([^"]+)"/g))) {
        expect(markup, `${page.path} uses #${id}`).toContain(`<symbol id="${id}"`);
      }
    }
  });

  it('describes and sizes every image, and the files are there', async () => {
    for (const page of PAGES) {
      const markup = await site().read(fileOf(page.path));
      for (const img of markup.match(/<img [^>]*>/g) ?? []) {
        expect(img, page.path).toMatch(/\salt="[^"]*"/);
        expect(img, page.path).toMatch(/\swidth="\d+" height="\d+"/);
        const src = /\ssrc="([^"]+)"/.exec(img)?.[1] ?? '';
        expect(await exists(join(site().publicDir, src)), src).toBe(true);
      }
    }
  });

  it('is listed in the sitemap', async () => {
    const sitemap = await site().read('sitemap.xml');
    for (const page of PAGES) {
      expect(sitemap).toContain(`<loc>${new URL(page.path, TEST_ORIGIN).href}</loc>`);
    }
  });
});

describe('the waitlist form on the Cloud page', () => {
  it('posts to the API without JavaScript, and loads the script that improves it', async () => {
    const markup = await site().read('cloud/index.html');
    expect(markup).toContain(
      '<form class="waitlist-form" id="waitlist-form" action="/api/waitlist" method="post"',
    );
    expect(markup).toMatch(
      /<script type="module" src="\/assets\/[0-9a-f]+\/waitlist\.js"><\/script>/,
    );
    for (const field of ['name', 'company', 'role', 'email', 'message', 'consent']) {
      expect(markup).toContain(
        `<label class="${field === 'consent' ? 'checkbox__label' : 'field__label'}" for="waitlist-${field}"`,
      );
    }
  });

  it('ships the script with its types stripped', async () => {
    const script = await site().read(site().render.assets.waitlistScript);
    expect(script).toContain("addEventListener('submit'");
    expect(script).not.toMatch(/\binterface\b|: HTMLFormElement/);
  });
});

describe('the html template', () => {
  it('escapes what it interpolates, but not markup built with it', () => {
    const name = '<b>"Anna" & co</b>';
    expect(html`<p title="${name}">${name}</p>`.value).toBe(
      '<p title="&lt;b&gt;&quot;Anna&quot; &amp; co&lt;/b&gt;">&lt;b&gt;&quot;Anna&quot; &amp; co&lt;/b&gt;</p>',
    );
    expect(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`.value).toBe(
      '<ul><li>a</li><li>b</li></ul>',
    );
    expect(html`${false}${null}${undefined}${0}`.value).toBe('0');
  });

  it('turns backticks in copy into code', () => {
    expect(prose('Send `handover.sealed` <now>').value).toBe(
      'Send <code>handover.sealed</code> &lt;now&gt;',
    );
  });
});
