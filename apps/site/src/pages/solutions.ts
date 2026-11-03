import {
  actions,
  arrowLink,
  button,
  card,
  cardGrid,
  ctaBand,
  device,
  pageHero,
  section,
  sectionHeading,
} from '../components.ts';
import { mailto, repoFolder, SITE, WAITLIST_URL } from '../config.ts';
import { type Html, html, prose } from '../html.ts';
import { icon } from '../icons.ts';
import type { Page } from '../layout.ts';
import { SOLUTIONS, type Solution, solutionPath } from '../solutions.ts';

/** A card per solution, each linking to its page. */
export function solutionCards(except?: Solution): Html {
  return html`<ul class="audience-grid${except ? ' audience-grid--compact' : ''}">
  ${SOLUTIONS.filter((s) => s !== except).map(
    (s) => html`<li class="audience">
    <span class="audience__icon">${icon(s.icon)}</span>
    <h3 class="audience__title"><a class="audience__link" href="${solutionPath(s)}">${s.audience}</a></h3>
    <p>${s.summary}</p>
    <span class="audience__more" aria-hidden="true">See how ${icon('arrow-right', 'icon audience__arrow')}</span>
  </li>`,
  )}
</ul>`;
}

function closingCta(): Html {
  return ctaBand({
    id: 'cta-title',
    title: 'See it on your own containers',
    body: 'Join the Plomba Cloud waitlist, self-host it today, or write to us for an access code to the live demo.',
    actions: actions(
      button({ href: WAITLIST_URL, label: 'Join the waitlist' }),
      button({ href: mailto('Plomba'), label: 'Talk to us', variant: 'on-dark', icon: 'mail' }),
    ),
  });
}

function solutionPage(solution: Solution): Page {
  const { integration } = solution;
  return {
    path: solutionPath(solution),
    title: solution.metaTitle,
    description: solution.metaDescription,
    body: () => html`${pageHero({
      eyebrow: `For ${solution.audience.toLowerCase()}`,
      eyebrowIcon: solution.icon,
      title: solution.title,
      lead: solution.lead,
      actions: actions(
        button({ href: WAITLIST_URL, label: 'Join the Cloud waitlist' }),
        button({ href: '/integrations/', label: 'See the integrations', variant: 'on-dark' }),
      ),
    })}
${section(
  { labelledBy: 'pains-title' },
  sectionHeading({
    id: 'pains-title',
    eyebrow: 'What gets in the way',
    title: 'Where the record breaks today',
  }),
  cardGrid(
    solution.pains.map((pain, i) =>
      card({ kicker: String(i + 1).padStart(2, '0'), title: pain.title, body: pain.body }),
    ),
  ),
)}
${section(
  { labelledBy: 'gains-title', tone: 'paper' },
  html`<div class="split split--media">
    <div>
      ${sectionHeading({ id: 'gains-title', eyebrow: 'What Plomba gives you', title: 'The same sealed record on both sides of the gate' })}
      <ul class="gain-list">
        ${solution.gains.map(
          (gain) => html`<li class="gain">
          <span class="gain__icon">${icon(gain.icon)}</span>
          <div><h3 class="gain__title">${gain.title}</h3><p>${prose(gain.body)}</p></div>
        </li>`,
        )}
      </ul>
    </div>
    ${device(solution.screen, { caption: solution.screenCaption })}
  </div>`,
)}
${section(
  { labelledBy: 'integrate-title' },
  html`<div class="split">
    ${sectionHeading({ id: 'integrate-title', eyebrow: 'How it fits in', title: 'Connect it to your systems', intro: integration.intro })}
    <div>
      <ol class="numbered-list">${integration.steps.map((step) => html`<li><p>${prose(step)}</p></li>`)}</ol>
      ${
        integration.example
          ? html`<a class="example-link" href="${repoFolder(integration.example.folder)}">
          <span class="example-link__icon">${icon('braces')}</span>
          <span><span class="example-link__label">Runnable example</span>
          <code class="example-link__path">${integration.example.folder}</code>
          <span class="example-link__description">${integration.example.description}</span></span>
          ${icon('arrow-up-right')}
        </a>`
          : ''
      }
      <p>${arrowLink('/integrations/', 'REST API, webhooks, CODECO and the EIR')}</p>
    </div>
  </div>`,
)}
${section(
  { labelledBy: 'others-title', tone: 'paper' },
  sectionHeading({ id: 'others-title', title: 'Plomba for the other parties' }),
  solutionCards(solution),
)}
${closingCta()}`,
  };
}

export const solutionPages: readonly Page[] = SOLUTIONS.map(solutionPage);

export const solutionsIndex: Page = {
  path: '/solutions/',
  title: 'Solutions: Plomba for every party at a container handover',
  description:
    'How Plomba serves shipping lines, rail and intermodal operators, trucking companies, container owners and lessors, and terminals and depots.',
  body: () => html`${pageHero({
    eyebrow: 'Solutions',
    title: 'One record, every side of the gate',
    lead: 'A container passes through several companies between the seaport and the customer. Each needs the same thing from a handover: proof of the condition it was in. Here is what Plomba gives each of them.',
  })}
${section(
  { labelledBy: 'solutions-title' },
  html`<h2 class="visually-hidden" id="solutions-title">Who Plomba is for</h2>`,
  solutionCards(),
  html`<p class="section-footnote">Not on the list? Plomba works wherever a container changes hands. <a href="${mailto('Plomba')}">Write to ${SITE.email}</a>.</p>`,
)}
${closingCta()}`,
};
