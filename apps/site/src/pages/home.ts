import {
  actions,
  arrowLink,
  button,
  card,
  cardGrid,
  ctaBand,
  device,
  feature,
  section,
  sectionHeading,
} from '../components.ts';
import { mailto, repoFile, SITE, WAITLIST_URL } from '../config.ts';
import { chainFigure, journeyFigure, passportFigure, voiceFigure } from '../figures.ts';
import { type Html, html } from '../html.ts';
import { type IconName, icon } from '../icons.ts';
import { IMAGES } from '../images.ts';
import type { Page } from '../layout.ts';
import { solutionCards } from './solutions.ts';

function hero(): Html {
  return html`<section class="hero" aria-labelledby="page-title">
  <div class="container hero__inner">
    <div class="hero__copy">
      <p class="eyebrow">Open source · for container handovers</p>
      <h1 class="hero__title" id="page-title">A digital seal on a container's condition at every handover</h1>
      <p class="hero__lead">Plomba is a phone app for the checker at the gate. It records a shipping container's condition at every handover, from port and rail to inland terminal, truck and depot, and keeps each mark on the container itself. The next handover, in another city, sees the same damage on the same spot.</p>
      ${actions(
        button({ href: WAITLIST_URL, label: 'Join the Cloud waitlist' }),
        button({
          href: SITE.repo,
          label: 'Self-host from GitHub',
          variant: 'on-dark',
          icon: 'git-fork',
        }),
      )}
      <p class="hero__note">No container nearby? <a href="${SITE.demo}/try">Try the live demo on sample footage</a>. Ask <a href="${mailto('Plomba demo access code')}">${SITE.email}</a> for the access code.</p>
    </div>
    <div class="hero__screens">
      ${device(IMAGES.walkaround, { className: 'hero__screen hero__screen--back-left' })}
      ${device(IMAGES.handover, { className: 'hero__screen hero__screen--front', eager: true })}
      ${device(IMAGES.passport, { className: 'hero__screen hero__screen--back-right' })}
    </div>
  </div>
</section>`;
}

const FACTS: readonly { icon: IconName; text: string }[] = [
  { icon: 'smartphone', text: 'Installs from the browser on iPhone and Android' },
  { icon: 'cpu', text: "Runs on Meta's models: SAM 3.1, Muse Spark, Muse Voice Transcribe" },
  { icon: 'list-checks', text: 'ISO 6346, ISO 9897 (CEDEX) and EDIFACT CODECO' },
  { icon: 'server', text: 'Self-hosted in one Docker container, Apache-2.0' },
];

function facts(): Html {
  return html`<div class="facts">
  <ul class="container facts__list" aria-label="Plomba at a glance">
    ${FACTS.map((fact) => html`<li class="facts__item">${icon(fact.icon)}<span>${fact.text}</span></li>`)}
  </ul>
</div>`;
}

function problem(): Html {
  return section(
    { labelledBy: 'problem-title' },
    sectionHeading({
      id: 'problem-title',
      eyebrow: 'The problem',
      title: "Liability moves at every handover. The record doesn't.",
      intro:
        "On its way from the seaport to the customer, a container changes hands several times, and each handover moves liability for damage. Yet at most inland and rail terminals, the container's condition is still recorded on a paper form or in a few loose phone photos.",
    }),
    journeyFigure(),
    cardGrid([
      card({
        icon: 'history',
        title: "Damage can't be placed in time",
        body: "Without comparable records from both sides of each handover, a dent found at the depot can't be traced to the leg where it happened. Whoever holds the container when it's found often pays.",
      }),
      card({
        icon: 'list-checks',
        title: 'Inspections vary',
        body: 'Coverage depends on the checker. Faces get skipped, photos lack a date or a place, and damage is written in free text instead of standard codes.',
      }),
      card({
        icon: 'archive',
        title: 'The record stays behind',
        body: 'Each site keeps its own paper and photos, so the next handover starts from nothing and nobody can compare one with the other.',
      }),
    ]),
  );
}

interface Step {
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
}

const STEPS: readonly Step[] = [
  {
    icon: 'scan-text',
    title: 'Identify',
    body: "Point the phone at the doors. Muse Spark reads the container number and the ISO 6346 check digit verifies it. Only a read that passes is accepted; anything else is a suggestion the checker taps. The container's history loads.",
    tags: ['Muse Spark', 'ISO 6346'],
  },
  {
    icon: 'video',
    title: 'Photograph, or walk around once',
    body: "Each photo is registered to its face of the container from SAM 3.1's outline, so marks are kept in metres on the container. Or the checker records one walk-around video, and SAM 3.1 tracks the container through every frame.",
    tags: ['SAM 3.1'],
  },
  {
    icon: 'history',
    title: 'See the last handover',
    body: 'Damage recorded at the previous handover is drawn on the same spot of the new photos and over the live camera. The checker marks each item still there, changed or repaired.',
    tags: ['Container coordinates'],
  },
  {
    icon: 'mic',
    title: 'Record new damage',
    body: 'Muse Spark finds damage and codes it to ISO 9897 (CEDEX), and SAM 3.1 outlines it. Or the checker says it aloud, in Polish or English. The location code comes from where the mark sits on the container.',
    tags: ['Muse Spark', 'SAM 3.1', 'Muse Voice Transcribe'],
  },
  {
    icon: 'stamp',
    title: 'Seal',
    body: "The handover is hash-chained into the container's history. Out come an EIR, an EDIFACT CODECO gate message and, for new damage, a claim drafted by an agent and checked against the sealed records.",
    tags: ['SHA-256', 'EIR', 'CODECO'],
  },
];

function howItWorks(): Html {
  return section(
    { labelledBy: 'how-title', tone: 'paper', id: 'how-it-works' },
    html`<div class="split split--sticky">
      <div>
        ${sectionHeading({
          id: 'how-title',
          eyebrow: 'How it works',
          title: 'One walk-around per handover, sealed and passed on',
          intro:
            "The checker installs Plomba from the browser and walks around the container with the phone. Meta's models read, find and code. The checker confirms every proposal, and code checks the rest.",
        })}
        <p class="note">${icon('shield-check')}<span>Faces and number plates are blurred, and location metadata stripped, before a photo is stored.</span></p>
      </div>
      <ol class="steps">
        ${STEPS.map(
          (step, i) => html`<li class="step">
          <span class="step__marker">${icon(step.icon)}</span>
          <div class="step__content">
            <p class="step__number">Step ${i + 1}</p>
            <h3 class="step__title">${step.title}</h3>
            <p>${step.body}</p>
            <ul class="tags" aria-label="Used in this step">${step.tags.map((tag) => html`<li>${tag}</li>`)}</ul>
          </div>
        </li>`,
        )}
      </ol>
    </div>`,
  );
}

function moments(): Html {
  return section(
    { labelledBy: 'moments-title' },
    sectionHeading({
      id: 'moments-title',
      eyebrow: 'In the app',
      title: "What a paper form can't do",
      centred: true,
    }),
    feature({
      id: 'moment-same-spot',
      icon: 'crosshair',
      title: "The last handover's damage, on the same spot",
      body: html`<p>Plomba stores each mark in the container's own coordinates, in metres on a face, not in a photo. Any phone that later photographs that face gets the mark drawn back in place: on photos, on recorded video and over the live camera.</p>
        <p>The checker confirms each one still there, changed or repaired, so only damage that's really new counts as new.</p>`,
      visual: device(IMAGES.handover, {
        caption:
          'A corrosion mark from the last handover, LX50 CO, drawn on a new photo of the left side.',
      }),
    }),
    feature({
      id: 'moment-walkaround',
      icon: 'video',
      title: 'One walk-around video instead of five photos',
      reversed: true,
      body: html`<p>The checker records one slow walk around the container, on a phone or Meta AI glasses. SAM 3.1 tracks the container through every frame. Plomba picks the frames where a face is whole and splits corner views into their two faces, and Muse Spark names each face.</p>
        <p>The checker confirms, and the frames become the photos.</p>`,
      visual: device(IMAGES.walkaround, {
        caption:
          'SAM 3.1 tracks the container through the clip; Muse Spark named the doors and the right side of this corner view.',
      }),
    }),
    feature({
      id: 'moment-voice',
      icon: 'mic',
      title: 'Damage, said aloud',
      body: html`<p>Hands busy, gloves on: the checker says what they see, in Polish or English. Muse Voice Transcribe writes it down, Muse Spark codes it onto the sections named, and the checker confirms the proposal.</p>
        <p>The location code follows from the section and the half, so nobody has to remember it.</p>`,
      visual: voiceFigure(),
    }),
    feature({
      id: 'moment-passport',
      icon: 'book-open-check',
      title: 'The damage passport',
      reversed: true,
      body: html`<p>Every damage on the container, coloured by the handover that first recorded it, and built only from sealed records.</p>
        <p>Plomba places each damage between the last handover that photographed the spot clean and the first that recorded it. That's the question a claim turns on: where did it happen?</p>`,
      visual: passportFigure(),
    }),
  );
}

const OUTPUTS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'file-text',
    title: 'Equipment interchange receipt',
    body: 'The EIR the parties keep, with the photos and every damage, as a PDF.',
  },
  {
    icon: 'file-code',
    title: 'EDIFACT CODECO',
    body: "The gate-in or gate-out message, D.95B, with ISO 9897 damage codes and the record's hash.",
  },
  {
    icon: 'scale',
    title: 'A claim, checked',
    body: 'For new damage, a Muse Spark agent drafts a claim. Every item and hash it cites is checked against the sealed records before you see it.',
  },
];

function sealed(): Html {
  return section(
    { labelledBy: 'sealed-title', tone: 'navy' },
    html`<div class="split">
      <div>
        ${sectionHeading({
          id: 'sealed-title',
          eyebrow: 'Sealed records',
          title: 'A history nobody can quietly change',
          intro:
            "Sealing a handover hashes its record, its marks and its photos' SHA-256 together with the previous record's hash. Change anything later and the chain breaks at that record, and Plomba shows where.",
        })}
        <ul class="outputs">
          ${OUTPUTS.map(
            (output) => html`<li class="outputs__item">
            <span class="outputs__icon">${icon(output.icon)}</span>
            <div><h3 class="outputs__title">${output.title}</h3><p>${output.body}</p></div>
          </li>`,
          )}
        </ul>
      </div>
      ${chainFigure()}
    </div>`,
  );
}

interface Model {
  readonly name: string;
  readonly access: string;
  readonly job: string;
}

const MODELS: readonly Model[] = [
  {
    name: 'SAM 3.1',
    access: 'Meta Model API',
    job: "Outlines the container to register each photo to its face, tracks it through walk-around videos, outlines damage from Muse Spark's boxes, and finds faces and number plates to blur.",
  },
  {
    name: 'Muse Spark',
    access: 'Meta Model API',
    job: 'Reads the container number, names the face in each walk-around frame, finds and codes damage to CEDEX, and drafts claims with tools.',
  },
  {
    name: 'Muse Voice Transcribe',
    access: 'Meta Model API',
    job: 'Writes down damage said aloud, in Polish or English, biased to container vocabulary, for Muse Spark to code.',
  },
  {
    name: 'Muse Spark Open',
    access: 'Open weights',
    job: 'Runs the same vision jobs on open weights, through any OpenAI-compatible endpoint, for companies that host the model themselves.',
  },
];

const RESULTS: readonly { value: string; label: string }[] = [
  {
    value: '61.5%',
    label:
      'of 96 real photos of container numbers verified with no input from the checker, on Muse Spark',
  },
  {
    value: '0',
    label: 'wrong container numbers accepted, on Muse Spark and on Muse Spark Open',
  },
  {
    value: '54.2%',
    label: 'of the same photos verified with no input on Muse Spark Open, the open weights',
  },
  {
    value: '20 of 20',
    label: 'typed damage notes, Polish and English, coded exactly to CEDEX on both models',
  },
];

function models(): Html {
  return section(
    { labelledBy: 'models-title', id: 'models' },
    sectionHeading({
      id: 'models-title',
      eyebrow: "Built on Meta's models",
      title: 'The models see, read and listen. Code checks them.',
      intro:
        'Every model Plomba calls is a Meta model, through the Meta Model API or open weights. Where a model can be wrong, deterministic code or the checker decides: the check digit verifies every number, and claim evidence is checked against the sealed records.',
    }),
    html`<div class="model-grid">
      ${MODELS.map(
        (model) => html`<article class="model">
        <p class="model__access">${model.access}</p>
        <h3 class="model__name">${model.name}</h3>
        <p>${model.job}</p>
      </article>`,
      )}
    </div>`,
    html`<div class="results" role="group" aria-labelledby="results-title">
      <h3 class="results__title" id="results-title">Measured on openly licensed data</h3>
      <dl class="results__grid">
        ${RESULTS.map((r) => html`<div class="result"><dt class="result__label">${r.label}</dt><dd class="result__value">${r.value}</dd></div>`)}
      </dl>
      <p class="results__note">Identification was measured on the TRUDI dataset (CC BY-SA 4.0), damage-note coding on 20 notes typed by the author rather than recorded speech. Method, settings and limits: <a href="${repoFile('docs/evaluation.md')}">docs/evaluation.md</a>.</p>
    </div>`,
  );
}

function audiences(): Html {
  return section(
    { labelledBy: 'audiences-title', tone: 'paper' },
    sectionHeading({
      id: 'audiences-title',
      eyebrow: "Who it's for",
      title: 'For every party a container passes through',
      intro:
        "Plomba gives each of them the same sealed record, in the formats they already use, so a handover's evidence is the same on both sides of the gate.",
    }),
    solutionCards(),
  );
}

function plans(): Html {
  return section(
    { labelledBy: 'plans-title' },
    sectionHeading({
      id: 'plans-title',
      eyebrow: 'Open source and Cloud',
      title: 'Run it yourself, or let us run it',
      centred: true,
    }),
    html`<div class="choice">
      <article class="choice__option">
        <span class="choice__icon">${icon('server')}</span>
        <h3 class="choice__title">Open source</h3>
        <p>The whole app under Apache-2.0. One Docker image on your own machine, your data in one directory, your own Meta Model API key.</p>
        ${arrowLink('/open-source/', 'Self-host Plomba')}
      </article>
      <article class="choice__option choice__option--accent">
        <span class="choice__icon">${icon('cloud')}</span>
        <h3 class="choice__title">Plomba Cloud</h3>
        <p>We run it for you: hosting, updates and backups, your data in the EU, and support. Enterprise adds SSO, EDI and TOS connections, on-prem or private cloud, and an SLA.</p>
        ${arrowLink('/cloud/', 'See the plans')}
      </article>
    </div>`,
  );
}

export const home: Page = {
  path: '/',
  title: "Plomba: a digital seal on a container's condition at every handover",
  description:
    "Plomba records a shipping container's condition at every handover on the checker's phone and seals it into a history the next handover sees. Open source.",
  body: () => html`${hero()}
${facts()}
${problem()}
${howItWorks()}
${moments()}
${sealed()}
${models()}
${audiences()}
${plans()}
${ctaBand({
  id: 'cta-title',
  title: 'Put a seal on your next handover',
  body: 'Join the waitlist for Plomba Cloud, self-host it today, or write to us for an access code to the live demo.',
  actions: actions(
    button({ href: WAITLIST_URL, label: 'Join the waitlist' }),
    button({
      href: mailto('Plomba'),
      label: `Email ${SITE.email}`,
      variant: 'on-dark',
      icon: 'mail',
    }),
  ),
})}`,
};
