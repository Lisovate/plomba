import {
  actions,
  arrowLink,
  button,
  card,
  cardGrid,
  checkList,
  codeBlock,
  ctaBand,
  pageHero,
  section,
  sectionHeading,
} from '../components.ts';
import { repoFile, SITE, WAITLIST_URL } from '../config.ts';
import { type Html, html, prose } from '../html.ts';
import type { Page } from '../layout.ts';

function whatYouGet(): Html {
  return section(
    { labelledBy: 'get-title' },
    sectionHeading({
      id: 'get-title',
      eyebrow: 'What you get',
      title: 'The whole product, not a demo of it',
      intro:
        'Everything Plomba does is in the repository: the app, the server, the model calls with their prompts, and the scripts that measure them.',
    }),
    cardGrid(
      [
        card({
          icon: 'smartphone',
          title: 'The phone app',
          body: 'An installable web app for iPhone and Android, in English and Polish: identification, photos and walk-around videos, marks, voice notes and sealing.',
        }),
        card({
          icon: 'server',
          title: 'The server',
          body: 'TypeScript on Node.js 24 with SQLite and a photo store. It holds the Meta Model API key, so phones never talk to the models directly.',
        }),
        card({
          icon: 'shield-check',
          title: 'The evidence',
          body: 'The hash chain, the damage passport, the EIR, EDIFACT CODECO, and the claim agent whose drafts are checked against the sealed records.',
        }),
        card({
          icon: 'list-checks',
          title: 'The measurements',
          body: 'Evaluation scripts and their results on openly licensed data, so you can rerun them on your own photos before you rely on them.',
        }),
      ],
      { compact: true },
    ),
  );
}

function selfHosting(): Html {
  return section(
    { labelledBy: 'hosting-title', tone: 'paper', id: 'self-hosting' },
    html`<div class="split">
      <div>
        ${sectionHeading({
          id: 'hosting-title',
          eyebrow: 'Self-hosting',
          title: 'One container on your own machine',
          intro:
            'Plomba runs as one Docker image: the API server, which also serves the app. Its data lives in one directory, a SQLite database and the photos, so backing it up is copying a folder.',
        })}
        <h3 class="subheading">What you need</h3>
        ${checkList([
          'A Linux machine with Docker, or Node.js 24',
          'A Meta Model API key',
          html`A domain name with HTTPS. Phones only allow the camera on HTTPS pages.`,
        ])}
      </div>
      <div>
        <ol class="numbered-list numbered-list--steps">
          <li>
            <p>Save the Meta Model API key in a file outside any repository, readable only by you.</p>
          </li>
          <li>
            <p>Build and start it. The key is passed as a Docker secret, never as an environment variable.</p>
            ${codeBlock('META_API_KEY_PATH=/etc/plomba/meta.key docker compose up -d --build', 'Starting Plomba with Docker Compose')}
          </li>
          <li>
            <p>${prose('Put HTTPS in front, then open the address on a phone and add it to the home screen. Set `PLOMBA_ACCESS_CODE`, or put your single sign-on in front, so only your people can use it.')}</p>
          </li>
        </ol>
        <p>${arrowLink(repoFile('docs/self-hosting.md'), 'Read the self-hosting guide')}</p>
      </div>
    </div>`,
  );
}

function openWeights(): Html {
  return section(
    { labelledBy: 'weights-title' },
    html`<div class="split">
      ${sectionHeading({
        id: 'weights-title',
        eyebrow: 'Open weights',
        title: 'Run the vision model on your own hardware',
        intro:
          'Reading container numbers, naming faces and finding damage can run on Meta open-weights models through any OpenAI-compatible endpoint, such as one on your own machine. SAM 3.1 and Muse Voice Transcribe stay on the Meta Model API.',
      })}
      <dl class="results__grid results__grid--compact">
        <div class="result"><dt class="result__label">of 96 real photos of container numbers verified with no input on Muse Spark Open</dt><dd class="result__value">54.2%</dd></div>
        <div class="result"><dt class="result__label">wrong numbers accepted: the check digit keeps open weights as safe</dt><dd class="result__value">0</dd></div>
      </dl>
    </div>`,
  );
}

function licence(): Html {
  return section(
    { labelledBy: 'licence-title', tone: 'paper' },
    html`<div class="split">
      ${sectionHeading({
        id: 'licence-title',
        eyebrow: 'Licence',
        title: 'Apache-2.0',
        intro:
          'Use Plomba, change it and run it in your business, including commercially. Keep the licence and the notices with it. The licence also grants the patent rights you need to use the code.',
      })}
      <div>
        ${checkList([
          html`The licence: <a href="${repoFile('LICENSE')}">LICENSE</a>`,
          html`Third-party components keep their own licences, listed in <a href="${repoFile('NOTICE')}">NOTICE</a>; SAM 3.1's parser, for example, is under the SAM License.`,
          html`Before contributing, read <a href="${repoFile('CONTRIBUTING.md')}">CONTRIBUTING.md</a>: checks, secrets, data and privacy rules.`,
        ])}
      </div>
    </div>`,
  );
}

export const openSource: Page = {
  path: '/open-source/',
  title: 'Open source: self-host Plomba in one container · Plomba',
  description:
    "Plomba is open source under Apache-2.0. Run the whole app on your own machine in one Docker container, keep your data, and use Meta's open weights for vision.",
  body: () => html`${pageHero({
    eyebrow: 'Open source',
    eyebrowIcon: 'git-fork',
    title: 'Open source, and built to be self-hosted',
    lead: 'Plomba is licensed under Apache-2.0. A terminal, depot or rail operator can run the whole thing on its own machine, keep its own data and change what it needs.',
    actions: actions(
      button({ href: SITE.repo, label: 'View the source on GitHub', icon: 'git-fork' }),
      button({
        href: repoFile('docs/self-hosting.md'),
        label: 'Self-hosting guide',
        variant: 'on-dark',
      }),
    ),
  })}
${whatYouGet()}
${selfHosting()}
${openWeights()}
${licence()}
${ctaBand({
  id: 'cta-title',
  title: 'Rather not run it yourself?',
  body: 'Plomba Cloud is the managed version: hosting, updates and backups, your data in the EU, and support.',
  actions: actions(
    button({ href: WAITLIST_URL, label: 'Join the waitlist' }),
    button({ href: '/cloud/', label: 'Compare the plans', variant: 'on-dark' }),
  ),
})}`,
};
