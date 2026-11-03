/** Building blocks the pages are made of. Each returns markup styled by site.css. */

import { type Fragment, type Html, html, prose } from './html.ts';
import { type IconName, icon } from './icons.ts';
import type { Image } from './images.ts';

export type Tone = 'white' | 'paper' | 'navy';

interface SectionOptions {
  /** The id of the section's heading. */
  readonly labelledBy: string;
  readonly tone?: Tone;
  readonly id?: string;
}

export function section(options: SectionOptions, ...content: Fragment[]): Html {
  return html`<section class="section section--${options.tone ?? 'white'}"${options.id ? html` id="${options.id}"` : ''} aria-labelledby="${options.labelledBy}">
  <div class="container">${content}</div>
</section>`;
}

interface HeadingOptions {
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly intro?: Fragment;
  readonly centred?: boolean;
}

/** A section's eyebrow, <h2> and introduction. */
export function sectionHeading(options: HeadingOptions): Html {
  return html`<header class="section-heading${options.centred ? ' section-heading--centred' : ''}">
  ${options.eyebrow ? html`<p class="eyebrow">${options.eyebrow}</p>` : ''}
  <h2 class="section-heading__title" id="${options.id}">${options.title}</h2>
  ${options.intro ? html`<p class="section-heading__intro">${options.intro}</p>` : ''}
</header>`;
}

interface PageHeroOptions {
  readonly eyebrow: string;
  readonly eyebrowIcon?: IconName;
  readonly title: string;
  readonly lead: Fragment;
  readonly actions?: Fragment;
  /** Shown beside the text on wide screens. */
  readonly aside?: Fragment;
}

/** The navy band at the top of every page but the home page, with the page's <h1>. */
export function pageHero(options: PageHeroOptions): Html {
  return html`<section class="page-hero${options.aside ? ' page-hero--with-aside' : ''}" aria-labelledby="page-title">
  <div class="container page-hero__inner">
    <div class="page-hero__copy">
      <p class="eyebrow">${options.eyebrowIcon ? icon(options.eyebrowIcon) : ''}${options.eyebrow}</p>
      <h1 class="page-hero__title" id="page-title">${options.title}</h1>
      <p class="page-hero__lead">${options.lead}</p>
      ${options.actions ?? ''}
    </div>
    ${options.aside ? html`<div class="page-hero__aside">${options.aside}</div>` : ''}
  </div>
</section>`;
}

type ButtonVariant = 'primary' | 'secondary' | 'on-dark';

interface ButtonOptions {
  readonly href: string;
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
}

export function button(options: ButtonOptions): Html {
  return html`<a class="button button--${options.variant ?? 'primary'}" href="${options.href}">${options.icon ? icon(options.icon) : ''}<span>${options.label}</span></a>`;
}

export function actions(...buttons: Html[]): Html {
  return html`<div class="actions">${buttons}</div>`;
}

/** A text link with an arrow, for "read more" links at the end of a card or section. */
export function arrowLink(href: string, label: string): Html {
  return html`<a class="arrow-link" href="${href}"><span>${label}</span>${icon('arrow-right', 'icon arrow-link__icon')}</a>`;
}

interface CardOptions {
  readonly title: string;
  readonly body: Fragment;
  readonly icon?: IconName;
  /** A label above the title, such as a number. */
  readonly kicker?: string;
}

export function card(options: CardOptions): Html {
  return html`<article class="card">
  ${options.icon ? html`<span class="card__icon">${icon(options.icon)}</span>` : ''}
  ${options.kicker ? html`<p class="card__kicker">${options.kicker}</p>` : ''}
  <h3 class="card__title">${options.title}</h3>
  <div class="card__body">${typeof options.body === 'string' ? html`<p>${prose(options.body)}</p>` : options.body}</div>
</article>`;
}

/** Cards in as many columns as fit; `compact` fits four on a wide screen. */
export function cardGrid(cards: readonly Html[], { compact = false } = {}): Html {
  return html`<div class="card-grid${compact ? ' card-grid--compact' : ''}">${cards}</div>`;
}

export function checkList(items: readonly Fragment[]): Html {
  return html`<ul class="check-list">${items.map((item) => html`<li>${icon('check')}<span>${item}</span></li>`)}</ul>`;
}

interface DeviceOptions {
  readonly caption?: string;
  /** Load at once: for images in the first screenful. */
  readonly eager?: boolean;
  readonly className?: string;
}

/** An app screenshot in a phone frame. */
export function device(image: Image, options: DeviceOptions = {}): Html {
  const img = html`<img src="${image.src}" width="${image.width}" height="${image.height}" alt="${image.alt}"${
    options.eager ? html` fetchpriority="high"` : html` loading="lazy"`
  } decoding="async">`;
  const frame = html`<div class="device">${img}</div>`;
  const classes = `device-figure${options.className ? ` ${options.className}` : ''}`;
  return options.caption
    ? html`<figure class="${classes}">${frame}<figcaption>${options.caption}</figcaption></figure>`
    : html`<div class="${classes}">${frame}</div>`;
}

/** A scrollable code sample. Focusable, so keyboard users can scroll it. */
export function codeBlock(code: string, label: string): Html {
  return html`<pre class="code-block" tabindex="0" aria-label="${label}"><code>${code}</code></pre>`;
}

interface FeatureOptions {
  readonly id: string;
  readonly icon: IconName;
  readonly eyebrow?: string;
  readonly title: string;
  readonly body: Fragment;
  readonly visual: Fragment;
  /** Puts the visual on the left on wide screens. */
  readonly reversed?: boolean;
}

/** Text beside a picture: one moment in the app. */
export function feature(options: FeatureOptions): Html {
  return html`<article class="feature${options.reversed ? ' feature--reversed' : ''}" aria-labelledby="${options.id}">
  <div class="feature__copy">
    <span class="feature__icon">${icon(options.icon)}</span>
    <h3 class="feature__title" id="${options.id}">${options.title}</h3>
    ${options.body}
  </div>
  <div class="feature__visual">${options.visual}</div>
</article>`;
}

interface CtaOptions {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly actions: Html;
}

/** The closing call to action at the foot of a page. */
export function ctaBand(options: CtaOptions): Html {
  return html`<section class="cta" aria-labelledby="${options.id}">
  <div class="container cta__inner">
    <div class="cta__copy">
      <h2 class="cta__title" id="${options.id}">${options.title}</h2>
      <p>${options.body}</p>
    </div>
    ${options.actions}
  </div>
</section>`;
}
