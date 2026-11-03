import { pageHero, section } from '../components.ts';
import { mailto, SITE } from '../config.ts';
import { html } from '../html.ts';
import type { Page } from '../layout.ts';

export const privacy: Page = {
  path: '/privacy/',
  title: 'Privacy: what the Plomba Cloud waitlist stores · Plomba',
  description:
    'What the Plomba Cloud waitlist stores and why, how to have it deleted, and what this website does not collect. Nothing is shared or sold.',
  body: () => html`${pageHero({
    eyebrow: 'Privacy',
    title: 'What we keep, and why',
    lead: 'This note covers this website and its Plomba Cloud waitlist. It is short because we collect little.',
  })}
${section(
  { labelledBy: 'privacy-store' },
  html`<div class="prose">
    <h2 id="privacy-store">What the waitlist stores</h2>
    <p>When you join the waitlist we store what you enter in the form: your name, your company, the kind of company it is, your email address, your message if you write one, and the time you agreed to this note.</p>

    <h2>Why</h2>
    <p>To contact you about Plomba Cloud, and to understand which companies need it. We use it for nothing else.</p>

    <h2>Who sees it</h2>
    <p>It is kept in a database on the server that runs this website, and only ${SITE.company} reads it. <strong>Nothing is shared or sold.</strong></p>

    <h2>What this website doesn't do</h2>
    <p>It sets no cookies, runs no analytics and loads nothing from other companies: the fonts and images come from this server. To stop the form being flooded, the server keeps your IP address in memory for about ten minutes after you send it. It isn't stored with your entry.</p>

    <h2>Having it deleted</h2>
    <p>Email <a href="${mailto('Delete my waitlist entry')}">${SITE.email}</a> from the address you signed up with, and we'll delete your entry. You can also ask us for a copy of what we hold, or to correct it.</p>

    <h2>Who we are</h2>
    <p>${SITE.company}, ${SITE.author}, ${SITE.place}. Email <a href="${mailto()}">${SITE.email}</a>.</p>

    <p class="prose__updated">Last updated 3 November 2026.</p>
  </div>`,
)}`,
};
