/**
 * Pages that aren't published on their own: the 404 page, and the pages the
 * server sends back when the waitlist form is posted without JavaScript.
 */

import { actions, arrowLink, button, pageHero, section } from '../components.ts';
import { mailto, NAV, SITE } from '../config.ts';
import { html } from '../html.ts';
import type { Page } from '../layout.ts';
import { type FormState, waitlistForm } from '../waitlist.ts';

export const notFound: Page = {
  path: '/404/',
  title: 'Page not found · Plomba',
  description:
    "The page you asked for isn't on the Plomba website. Try the home page or one of the sections listed here.",
  noindex: true,
  body: () => html`${pageHero({
    eyebrow: 'Error 404',
    title: "We couldn't find that page",
    lead: 'The address may be mistyped, or the page may have moved.',
    actions: actions(button({ href: '/', label: 'Go to the home page' })),
  })}
${section(
  { labelledBy: 'elsewhere-title' },
  html`<h2 class="subheading" id="elsewhere-title">Or try one of these</h2>
  <ul class="link-list">${NAV.map((item) => html`<li>${arrowLink(item.href, item.label)}</li>`)}</ul>`,
)}`,
};

const WAITLIST_DESCRIPTION = 'The Plomba Cloud waitlist.';

/** After a successful post. The name is the visitor's own input, escaped like all text. */
export function thankYouPage(name?: string): Page {
  return {
    path: '/cloud/',
    title: "You're on the waitlist · Plomba",
    description: WAITLIST_DESCRIPTION,
    noindex: true,
    body: () =>
      pageHero({
        eyebrow: 'Plomba Cloud waitlist',
        title: "You're on the waitlist",
        lead: `Thank you${name ? `, ${name}` : ''}. We'll write to you about Plomba Cloud.`,
        actions: actions(
          button({ href: '/', label: 'Back to the home page' }),
          button({ href: '/open-source/', label: 'Self-host Plomba today', variant: 'on-dark' }),
        ),
      }),
  };
}

/** The form again, with the visitor's input and what to fix. */
export function checkFormPage(state: FormState): Page {
  return {
    path: '/cloud/',
    title: 'Please check the form · Plomba',
    description: WAITLIST_DESCRIPTION,
    noindex: true,
    waitlistScript: true,
    body: () => html`${pageHero({
      eyebrow: 'Plomba Cloud waitlist',
      title: 'Please check the form',
      lead: 'Something in the form needs another look. Your answers are still here.',
    })}
${section(
  { labelledBy: 'form-title', tone: 'paper' },
  html`<h2 class="visually-hidden" id="form-title">Waitlist form</h2>
  <div class="form-card form-card--narrow">${waitlistForm(state)}</div>`,
)}`,
  };
}

export function tooManyRequestsPage(retryAfterSeconds: number): Page {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    path: '/cloud/',
    title: 'Too many attempts · Plomba',
    description: WAITLIST_DESCRIPTION,
    noindex: true,
    body: () =>
      pageHero({
        eyebrow: 'Plomba Cloud waitlist',
        title: 'Too many attempts',
        lead: `The form was sent too often from your connection. Please try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or write to us.`,
        actions: actions(
          button({
            href: mailto('Plomba Cloud waitlist'),
            label: `Email ${SITE.email}`,
            icon: 'mail',
          }),
        ),
      }),
  };
}
