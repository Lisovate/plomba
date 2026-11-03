import {
  actions,
  button,
  checkList,
  codeBlock,
  ctaBand,
  pageHero,
  section,
  sectionHeading,
} from '../components.ts';
import { mailto, repoFile, repoFolder } from '../config.ts';
import {
  CONTAINER,
  CORROSION,
  DENT,
  EXAMPLE_HANDOVERS,
  eventName,
  exampleCodeco,
  shortDate,
} from '../example.ts';
import { type Html, html, prose } from '../html.ts';
import { type IconName, icon } from '../icons.ts';
import type { Page } from '../layout.ts';
import { SOLUTIONS } from '../solutions.ts';

interface Channel {
  readonly id: string;
  readonly icon: IconName;
  readonly name: string;
  readonly summary: string;
}

const CHANNELS: readonly Channel[] = [
  {
    id: 'api',
    icon: 'braces',
    name: 'REST API',
    summary: 'JSON over HTTPS, described in OpenAPI.',
  },
  {
    id: 'webhooks',
    icon: 'webhook',
    name: 'Signed webhooks',
    summary: '`handover.sealed`, signed with HMAC-SHA256.',
  },
  {
    id: 'codeco',
    icon: 'file-code',
    name: 'EDIFACT CODECO',
    summary: 'Gate-in and gate-out messages, D.95B.',
  },
  {
    id: 'eir',
    icon: 'file-text',
    name: 'EIR as PDF',
    summary: 'The receipt the parties keep.',
  },
];

function overview(): Html {
  return html`<nav class="channel-nav" aria-label="Integrations on this page">
  <ul class="channel-nav__list">
    ${CHANNELS.map(
      (c) => html`<li><a class="channel-nav__link" href="#${c.id}">
      <span class="channel-nav__icon">${icon(c.icon)}</span>
      <span class="channel-nav__name">${c.name}</span>
      <span class="channel-nav__summary">${prose(c.summary)}</span>
    </a></li>`,
    )}
  </ul>
</nav>`;
}

const ENDPOINTS: readonly [method: string, path: string, purpose: string][] = [
  ['GET', '/api/containers/{number}', "A container's sealed history, with the hash chain verified"],
  ['POST', '/api/handovers', 'Start a handover'],
  ['GET', '/api/handovers/{id}', 'A handover with its photos and marks'],
  ['GET', '/api/handovers/{id}/codeco', 'The CODECO message for a sealed handover'],
  [
    'POST',
    '/api/handovers/{id}/claim',
    'Draft a claim for new damage, verified against the sealed records',
  ],
];

function api(): Html {
  return section(
    { labelledBy: 'api' },
    html`<div class="split">
      <div>
        ${sectionHeading({
          id: 'api',
          eyebrow: 'REST API',
          title: 'Everything the app does, over HTTPS',
          intro: prose(
            'The phone app uses the same JSON API you integrate with: containers, handovers, photos, marks, sealing and history. Every installation describes it in OpenAPI at `/api/openapi.json`, so you can generate a client in your own language.',
          ),
        })}
        ${codeBlock('curl https://plomba.example.com/api/openapi.json', 'Fetching the OpenAPI description')}
      </div>
      <div class="table-wrap" role="region" aria-labelledby="endpoints-caption" tabindex="0">
        <table class="table">
          <caption id="endpoints-caption">A few of the endpoints</caption>
          <thead><tr><th scope="col">Request</th><th scope="col">What it does</th></tr></thead>
          <tbody>
            ${ENDPOINTS.map(
              ([method, path, purpose]) =>
                html`<tr><td><code><span class="method">${method}</span> ${path}</code></td><td>${purpose}</td></tr>`,
            )}
          </tbody>
        </table>
      </div>
    </div>`,
  );
}

function webhooks(): Html {
  return section(
    { labelledBy: 'webhooks', tone: 'paper' },
    html`<div class="split">
      ${sectionHeading({
        id: 'webhooks',
        eyebrow: 'Signed webhooks',
        title: 'Hear about each handover as it is sealed',
        intro: prose(
          'Register an HTTPS endpoint and Plomba sends it a `handover.sealed` event whenever a handover is sealed, so your claims, fleet or transport system can fetch the record straight away.',
        ),
      })}
      <div>
        ${codeBlock('Plomba-Signature: t=<unix>,v1=<hex>', 'The signature header on each delivery')}
        <ul class="definition-list">
          <li><code>t</code> is when the delivery was signed, as Unix time. Reject old deliveries so a captured one can't be replayed.</li>
          <li><code>v1</code> is an HMAC-SHA256 signature in hex, made with your endpoint's secret. Check it, in constant time, before you trust the body.</li>
          <li>Each example in <a href="${repoFolder('examples')}"><code>examples/</code></a> shows how to verify a delivery.</li>
        </ul>
      </div>
    </div>`,
  );
}

function codeco(): Html {
  const latest = EXAMPLE_HANDOVERS.at(-1);
  return section(
    { labelledBy: 'codeco' },
    html`<div class="split">
      <div>
        ${sectionHeading({
          id: 'codeco',
          eyebrow: 'EDIFACT CODECO',
          title: 'Gate messages your EDI already reads',
          intro:
            'Every sealed handover can be sent as a CODECO, the container gate-in and gate-out report shipping lines and operators already exchange.',
        })}
        ${checkList([
          'Directory D.95B in the SMDG 1.6 profile: BGM 34 for gate-in, 36 for gate-out.',
          'Up to nine damages with ISO 9897 location, damage and component codes (DAM and COD).',
          "The sealed record's SHA-256 in an FTX segment, so the message points to the tamper-evident record.",
          'The road or rail leg that brought or collected the container (TDT).',
        ])}
      </div>
      <figure class="code-figure">
        ${codeBlock(exampleCodeco(), 'An example CODECO message')}
        <figcaption>The gate-out of ${CONTAINER.display}${latest ? ` at ${latest.place}` : ''}, generated by Plomba's own code (<a href="${repoFile('packages/core/src/codeco.ts')}"><code>codeco.ts</code></a>).</figcaption>
      </figure>
    </div>`,
  );
}

function eirIllustration(): Html {
  const latest = EXAMPLE_HANDOVERS.at(-1);
  const lastClean = EXAMPLE_HANDOVERS.filter((h) => h.dentSpot === 'clean').at(-1);
  if (!latest || !lastClean) throw new Error('The EIR example needs the example handovers');
  return html`<figure class="eir">
  <div class="eir__sheet">
    <p class="eir__heading">Equipment interchange receipt</p>
    <dl class="eir__fields">
      <div><dt>Container</dt><dd><code>${CONTAINER.display}</code> · ${CONTAINER.sizeType}</dd></div>
      <div><dt>Handover</dt><dd>#${latest.sequence} ${eventName(latest)} · ${latest.place}</dd></div>
      <div><dt>Date</dt><dd>${shortDate(latest.date)}</dd></div>
      <div><dt>Transport</dt><dd>${latest.transport}</dd></div>
    </dl>
    <table class="eir__damage">
      <caption class="visually-hidden">Damage on the receipt</caption>
      <thead><tr><th scope="col">Code</th><th scope="col">Damage</th><th scope="col">History</th></tr></thead>
      <tbody>
        <tr><td><code>${CORROSION.location} ${CORROSION.damage}</code></td><td>${CORROSION.damageName}</td><td>First recorded at #${CORROSION.firstRecorded}</td></tr>
        <tr><td><code>${DENT.location} ${DENT.damage}</code></td><td>${DENT.damageName}</td><td>New. Spot last photographed clean at #${lastClean.sequence}</td></tr>
      </tbody>
    </table>
    <p class="eir__hash">Record SHA-256 <code>${latest.hash}</code></p>
  </div>
  <figcaption>An illustration of what the receipt carries, for the example container.</figcaption>
</figure>`;
}

function eir(): Html {
  return section(
    { labelledBy: 'eir', tone: 'paper' },
    html`<div class="split">
      <div>
        ${sectionHeading({
          id: 'eir',
          eyebrow: 'EIR as PDF',
          title: 'The receipt both parties keep',
          intro:
            'Every sealed handover has an equipment interchange receipt: the parties, the place and time, the photos of each face and every damage with its code. Print it, or save it as a PDF.',
        })}
        ${checkList([
          'Each damage says where it was first recorded or, if it is new, which handover last photographed the spot clean.',
          "The sealed record's hash is on the receipt, so anyone can check it against the history.",
        ])}
      </div>
      ${eirIllustration()}
    </div>`,
  );
}

function examples(): Html {
  const withExamples = SOLUTIONS.flatMap((s) =>
    s.integration.example ? [{ solution: s, example: s.integration.example }] : [],
  );
  return section(
    { labelledBy: 'examples-title' },
    sectionHeading({
      id: 'examples-title',
      eyebrow: 'Examples',
      title: 'Runnable examples, one per party',
      intro: html`Small programs in the repository's <a href="${repoFolder('examples')}"><code>examples/</code></a> folder that show an integration from start to finish.`,
    }),
    html`<ul class="example-grid">
      ${withExamples.map(
        ({
          solution,
          example,
        }) => html`<li><a class="example-link" href="${repoFolder(example.folder)}">
        <span class="example-link__icon">${icon(solution.icon)}</span>
        <span><span class="example-link__label">${solution.audience}</span>
        <code class="example-link__path">${example.folder}</code>
        <span class="example-link__description">${example.description}</span></span>
        ${icon('arrow-up-right')}
      </a></li>`,
      )}
    </ul>`,
  );
}

const STANDARDS: readonly [name: string, use: string][] = [
  ['ISO 6346', 'Container numbers with their check digit, and size and type codes'],
  ['ISO 9897 (CEDEX)', 'Damage location, damage and component codes'],
  ['EDIFACT CODECO D.95B', 'Gate-in and gate-out reports, in the SMDG 1.6 profile'],
  ['UIC wagon numbers', 'Twelve digits with a self-check digit, checked as they are typed'],
];

function standards(): Html {
  return section(
    { labelledBy: 'standards-title', tone: 'paper' },
    html`<div class="split">
      ${sectionHeading({
        id: 'standards-title',
        eyebrow: 'Standards',
        title: 'Codes the industry already uses',
        intro:
          'Plomba records in the standards your partners already exchange, so its records fit the systems you run.',
      })}
      <dl class="standards">
        ${STANDARDS.map(([name, use]) => html`<div class="standards__item"><dt>${name}</dt><dd>${use}</dd></div>`)}
      </dl>
    </div>`,
  );
}

export const integrations: Page = {
  path: '/integrations/',
  title: 'Integrations: REST API, signed webhooks, EDIFACT CODECO and EIR · Plomba',
  description:
    'Connect Plomba to your systems: a REST API described in OpenAPI, signed handover.sealed webhooks, EDIFACT CODECO D.95B gate messages and the EIR as a PDF.',
  body: () => html`${pageHero({
    eyebrow: 'Integrations',
    title: 'Fits the systems you already run',
    lead: 'Plomba speaks the formats the container industry already uses. Read and react to sealed handovers over a REST API and signed webhooks, send CODECO gate messages, and hand out the EIR as a PDF.',
    aside: overview(),
  })}
${api()}
${webhooks()}
${codeco()}
${eir()}
${examples()}
${standards()}
${ctaBand({
  id: 'cta-title',
  title: 'Need EDI or TOS connections built for you?',
  body: 'Connections to your EDI partners and terminal operating system are part of Plomba Enterprise.',
  actions: actions(
    button({ href: '/cloud/', label: 'See the plans' }),
    button({
      href: mailto('Plomba Enterprise'),
      label: 'Talk to us',
      variant: 'on-dark',
      icon: 'mail',
    }),
  ),
})}`,
};
