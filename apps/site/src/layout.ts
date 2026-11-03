/**
 * The document every page shares: head metadata, header with navigation and
 * the footer. Pages provide only what goes inside <main>.
 */

import { mailto, NAV, repoFile, SITE, WAITLIST_URL } from './config.ts';
import { type Html, html, raw } from './html.ts';
import { icon } from './icons.ts';
import { IMAGES, PHOTO_CREDITS, PHOTO_LICENCE } from './images.ts';
import { SOLUTIONS, solutionPath } from './solutions.ts';

export interface Page {
  /** The URL path, ending in a slash: `/`, `/solutions/trucking/`. */
  readonly path: string;
  /** The whole <title>, also used for link previews. */
  readonly title: string;
  /** One or two plain sentences for search results and link previews. */
  readonly description: string;
  /** What goes inside <main>. */
  readonly body: () => Html;
  /** Pages that answer a form post: kept out of search engines, no canonical URL. */
  readonly noindex?: boolean;
  /** Loads the script that sends the waitlist form without leaving the page. */
  readonly waitlistScript?: boolean;
}

/** Built assets, under a content-hashed folder so browsers can cache them for good. */
export interface AssetUrls {
  readonly stylesheet: string;
  readonly waitlistScript: string;
  /** Fonts every page uses, preloaded. */
  readonly preloadFonts: readonly string[];
}

/** Everything a page needs besides its own content; the server loads it from the build. */
export interface RenderContext {
  readonly origin: string;
  readonly assets: AssetUrls;
  /** The inline SVG sprite that `icon()` points into. */
  readonly sprite: string;
}

export function renderDocument(page: Page, context: RenderContext): string {
  const url = new URL(page.path, context.origin).href;
  const image = new URL(IMAGES.social.src, context.origin).href;
  const document = html`<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
${page.noindex ? html`<meta name="robots" content="noindex">` : html`<link rel="canonical" href="${url}">`}
<meta name="theme-color" content="#0b1d33">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${context.assets.preloadFonts.map((font) => html`<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin>`)}
<link rel="stylesheet" href="${context.assets.stylesheet}">
${page.waitlistScript ? html`<script type="module" src="${context.assets.waitlistScript}"></script>` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="${IMAGES.social.width}">
<meta property="og:image:height" content="${IMAGES.social.height}">
<meta property="og:image:alt" content="${IMAGES.social.alt}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
${raw(context.sprite)}
<a class="skip-link" href="#main">Skip to content</a>
${siteHeader(page.path)}
<main id="main" tabindex="-1">
${page.body()}
</main>
${siteFooter()}
</body>
</html>
`;
  return `<!doctype html>\n${document.value}`;
}

/** `page` for the page itself, `true` for a section it belongs to. */
function currentState(pagePath: string, href: string): 'page' | 'true' | undefined {
  if (pagePath === href) return 'page';
  if (href !== '/' && pagePath.startsWith(href)) return 'true';
  return undefined;
}

function siteHeader(pagePath: string): Html {
  return html`<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="/">
      <img class="brand__logo" src="/favicon.svg" alt="" width="36" height="36">
      <span class="brand__name">${SITE.name}</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <ul class="site-nav__list">
        ${NAV.map(
          (item) =>
            html`<li><a class="site-nav__link" href="${item.href}"${currentAttribute(pagePath, item.href)}>${item.label}</a></li>`,
        )}
      </ul>
    </nav>
    <div class="site-header__actions">
      <a class="site-header__github" href="${SITE.repo}">${icon('git-fork')}<span>GitHub</span></a>
      <a class="button button--primary button--small" href="${WAITLIST_URL}">Join the waitlist</a>
    </div>
  </div>
</header>`;
}

function currentAttribute(pagePath: string, href: string): Html {
  const state = currentState(pagePath, href);
  return state ? html` aria-current="${state}"` : html``;
}

function siteFooter(): Html {
  const year = new Date().getUTCFullYear();
  return html`<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <div class="site-footer__about">
        <a class="brand brand--footer" href="/">
          <img class="brand__logo" src="/favicon.svg" alt="" width="36" height="36">
          <span class="brand__name">${SITE.name}</span>
        </a>
        <p>A digital seal on a container's condition at every handover. Open source under the Apache License 2.0.</p>
      </div>
      <nav class="site-footer__column" aria-labelledby="footer-product">
        <h2 class="site-footer__heading" id="footer-product">Product</h2>
        <ul>
          ${NAV.map((item) => html`<li><a href="${item.href}">${item.label}</a></li>`)}
          <li><a href="${SITE.demo}">Live demo</a></li>
        </ul>
      </nav>
      <nav class="site-footer__column" aria-labelledby="footer-solutions">
        <h2 class="site-footer__heading" id="footer-solutions">Solutions</h2>
        <ul>
          ${SOLUTIONS.map((s) => html`<li><a href="${solutionPath(s)}">${s.shortName}</a></li>`)}
        </ul>
      </nav>
      <div class="site-footer__column">
        <h2 class="site-footer__heading">Contact</h2>
        <ul>
          <li><a href="${mailto()}">${SITE.email}</a></li>
          <li><a href="${SITE.repo}">Source on GitHub</a></li>
          <li><a href="${repoFile('docs/self-hosting.md')}">Self-hosting guide</a></li>
          <li><a href="/privacy/">Privacy</a></li>
        </ul>
        <p class="site-footer__address">${SITE.company} · ${SITE.author}<br>${SITE.place}</p>
      </div>
    </div>
    <div class="site-footer__legal">
      <p>© ${year} ${SITE.company}. Plomba is licensed under <a href="${repoFile('LICENSE')}">Apache-2.0</a>.</p>
      <p class="site-footer__credits">
        App screens show frames of
        ${PHOTO_CREDITS.map(
          (credit, i) =>
            html`${i > 0 ? ' and ' : ''}“<a href="${credit.url}">${credit.title}</a>” by ${credit.author}`,
        )},
        both licensed <a href="${PHOTO_LICENCE.url}">${PHOTO_LICENCE.name}</a>. People in the walk-around clip are blurred; the handovers and the damage passport show test data.
      </p>
    </div>
  </div>
</footer>`;
}
