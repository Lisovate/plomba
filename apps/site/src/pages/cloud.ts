import { pageHero, section, sectionHeading } from '../components.ts';
import { mailto, repoFile, SITE } from '../config.ts';
import { type Html, html } from '../html.ts';
import { type IconName, icon } from '../icons.ts';
import type { Page } from '../layout.ts';
import { waitlistForm } from '../waitlist.ts';

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly summary: string;
  readonly features: readonly string[];
  readonly action: { readonly label: string; readonly href: string };
  readonly status?: string;
  readonly featured?: boolean;
}

const PLANS: readonly Plan[] = [
  {
    id: 'plan-open-source',
    name: 'Open source',
    icon: 'git-fork',
    summary: 'Free. Run it yourself, on your own machine.',
    features: [
      'The whole app, under Apache-2.0',
      'One Docker image, your data in one directory',
      'Your own Meta Model API key, or open weights for vision',
      'Community support on GitHub',
    ],
    action: { label: 'Read the self-hosting guide', href: repoFile('docs/self-hosting.md') },
  },
  {
    id: 'plan-cloud',
    name: 'Plomba Cloud',
    icon: 'cloud',
    summary: "Managed for companies that don't want to run it.",
    features: ['Managed hosting', 'Updates and backups', 'Your data in the EU', 'Support'],
    action: { label: 'Join the waitlist', href: '#waitlist' },
    status: 'Waitlist open',
    featured: true,
  },
  {
    id: 'plan-enterprise',
    name: 'Enterprise',
    icon: 'building-2',
    summary: 'For operators who need Plomba inside their own systems.',
    features: [
      'Single sign-on (SSO)',
      'EDI and TOS connections',
      'On-prem or private cloud',
      'A service-level agreement (SLA)',
    ],
    action: { label: 'Talk to us', href: mailto('Plomba Enterprise') },
  },
];

function plans(): Html {
  return section(
    { labelledBy: 'plans-title' },
    html`<h2 class="visually-hidden" id="plans-title">Plans</h2>`,
    html`<ul class="plans">
      ${PLANS.map(
        (plan) => html`<li class="plan${plan.featured ? ' plan--featured' : ''}">
        ${plan.status ? html`<p class="plan__status">${plan.status}</p>` : ''}
        <span class="plan__icon">${icon(plan.icon)}</span>
        <h3 class="plan__name" id="${plan.id}">${plan.name}</h3>
        <p class="plan__summary">${plan.summary}</p>
        <ul class="plan__features">
          ${plan.features.map((f) => html`<li>${icon('check')}<span>${f}</span></li>`)}
        </ul>
        <a class="button ${plan.featured ? 'button--primary' : 'button--secondary'} plan__action" href="${plan.action.href}">${plan.action.label}</a>
      </li>`,
      )}
    </ul>
    <p class="section-footnote">For Plomba Cloud and Enterprise pricing, write to <a href="${mailto('Plomba pricing')}">${SITE.email}</a>.</p>`,
  );
}

function waitlist(): Html {
  return section(
    { labelledBy: 'waitlist-title', tone: 'paper', id: 'waitlist' },
    html`<div class="split split--form">
      <div>
        ${sectionHeading({
          id: 'waitlist-title',
          eyebrow: 'Plomba Cloud',
          title: 'Join the waitlist',
          intro:
            "Plomba Cloud isn't open yet. Tell us who you are and we'll get in touch when it is.",
        })}
        <ul class="aside-list">
          <li>${icon('lock')}<span>We keep what you enter only to contact you about Plomba, and never share or sell it. <a href="/privacy/">Privacy note</a>.</span></li>
          <li>${icon('mail')}<span>Questions now? Write to <a href="${mailto('Plomba Cloud')}">${SITE.email}</a>.</span></li>
        </ul>
      </div>
      <div class="form-card">${waitlistForm()}</div>
    </div>`,
  );
}

export const cloud: Page = {
  path: '/cloud/',
  title: 'Plomba Cloud and plans: open source, managed or enterprise · Plomba',
  description:
    'Self-host Plomba for free, let us run it as Plomba Cloud with your data in the EU, or add SSO, EDI and TOS connections with Enterprise. Join the waitlist.',
  waitlistScript: true,
  body: () => html`${pageHero({
    eyebrow: 'Cloud and plans',
    eyebrowIcon: 'cloud',
    title: 'Run it yourself, or let us run it',
    lead: 'Plomba is open source: the whole app, under Apache-2.0. Anyone can self-host it for free. Plomba Cloud is the managed version for companies that would rather not run it, and Enterprise connects it to your own systems.',
  })}
${plans()}
${waitlist()}`,
};
