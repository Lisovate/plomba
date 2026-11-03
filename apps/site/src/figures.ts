/**
 * Illustrations drawn in code: the damage passport, the sealed chain, a spoken
 * damage note and a container's journey. They follow the example container in
 * example.ts, so every code and hash shown is one Plomba computed.
 */

import {
  CONTAINER,
  CORROSION,
  DENT,
  EXAMPLE_HANDOVERS,
  type ExampleDamage,
  type ExampleHandover,
  eventName,
  type SpotEvidence,
  shortDate,
} from './example.ts';
import { type Html, html } from './html.ts';
import { type IconName, icon } from './icons.ts';

/** The handover colours of the passport; checked for colour-blind separation. */
const FIRST_RECORDED_CLASS: Readonly<Record<number, string>> = { 1: 'is-first', 4: 'is-latest' };

const shortHash = (hash: string): string => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

// The damage passport ------------------------------------------------------

/** The left side of a 40 ft container, its CEDEX sections and two damages, in metres. */
function leftSideSvg(): Html {
  const { length, height } = CONTAINER.dimensions;
  const x0 = 16;
  const y0 = 44;
  const width = 448;
  const scale = width / length;
  const faceHeight = height * scale;
  const sectionWidth = width / 10;
  const toX = (u: number) => x0 + u * scale;
  const toY = (v: number) => y0 + (height - v) * scale;

  // Sections are counted from the door end, which is on the right when you face the left side.
  const sections = Array.from({ length: 10 }, (_, i) => ({
    label: String((i + 1) % 10),
    centre: x0 + width - (i + 0.5) * sectionWidth,
  }));

  const mark = (damage: ExampleDamage) => {
    const x = toX(damage.rect.u0) + 3;
    const y = toY(damage.rect.v1) + 3;
    const w = (damage.rect.u1 - damage.rect.u0) * scale - 6;
    const h = (damage.rect.v1 - damage.rect.v0) * scale - 6;
    const cx = x + w / 2;
    const cy = y + h / 2;
    return html`<g class="passport-mark ${FIRST_RECORDED_CLASS[damage.firstRecorded] ?? ''}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"></rect>
      <text x="${cx}" y="${cy - 3}" text-anchor="middle">${damage.location}</text>
      <text x="${cx}" y="${cy + 11}" text-anchor="middle">${damage.damage}</text>
    </g>`;
  };

  return html`<svg class="passport-svg" viewBox="0 0 480 176" role="img" aria-labelledby="passport-svg-title">
  <title id="passport-svg-title">The left side of container ${CONTAINER.display}, 40 ft, in ten sections numbered from the door end. Corrosion ${CORROSION.location} ${CORROSION.damage} in sections 7 and 8, upper half, first recorded at handover 1. A dent ${DENT.location} ${DENT.damage} in section 3, lower half, first recorded at handover 4.</title>
  <defs>
    <pattern id="corrugation" width="7" height="10" patternUnits="userSpaceOnUse">
      <rect class="passport-svg__rib" width="3.5" height="10"></rect>
    </pattern>
  </defs>
  <text class="passport-svg__label" x="${x0}" y="14">Left side · ${CONTAINER.display}</text>
  <text class="passport-svg__label" x="${x0 + width}" y="14" text-anchor="end">Door end →</text>
  ${sections.map((s) => html`<text class="passport-svg__section" x="${s.centre}" y="${y0 - 8}" text-anchor="middle">${s.label}</text>`)}
  <rect class="passport-svg__face" x="${x0}" y="${y0}" width="${width}" height="${faceHeight}"></rect>
  <rect x="${x0}" y="${y0}" width="${width}" height="${faceHeight}" fill="url(#corrugation)"></rect>
  ${sections.slice(1).map((s) => {
    const x = s.centre + sectionWidth / 2;
    return html`<line class="passport-svg__grid" x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + faceHeight}"></line>`;
  })}
  <line class="passport-svg__half" x1="${x0}" y1="${y0 + faceHeight / 2}" x2="${x0 + width}" y2="${y0 + faceHeight / 2}"></line>
  <rect class="passport-svg__frame" x="${x0}" y="${y0}" width="${width}" height="${faceHeight}" rx="2"></rect>
  ${mark(CORROSION)}
  ${mark(DENT)}
  <text class="passport-svg__label" x="${x0}" y="${y0 + faceHeight + 22}">Front end</text>
  <text class="passport-svg__label" x="${x0 + width}" y="${y0 + faceHeight + 22}" text-anchor="end">Sections counted from the door end</text>
</svg>`;
}

const EVIDENCE: Readonly<Record<SpotEvidence, { icon: IconName; text: string }>> = {
  clean: { icon: 'circle-check', text: 'Spot photographed, no dent' },
  'not-photographed': { icon: 'circle-dashed', text: 'No photo of this spot' },
  recorded: { icon: 'circle-dot', text: `Dent first recorded: ${DENT.location} ${DENT.damage}` },
};

export function passportFigure(): Html {
  const lastClean = EXAMPLE_HANDOVERS.filter((h) => h.dentSpot === 'clean').at(-1);
  const recorded = EXAMPLE_HANDOVERS.find((h) => h.dentSpot === 'recorded');
  if (!lastClean || !recorded) throw new Error('The example needs a clean and a recorded handover');
  const unseen = EXAMPLE_HANDOVERS.filter(
    (h) => h.sequence > lastClean.sequence && h.sequence < recorded.sequence,
  );
  const inWindow = (h: ExampleHandover) =>
    h.sequence >= lastClean.sequence && h.sequence <= recorded.sequence;

  return html`<figure class="passport">
  <div class="passport__drawing">${leftSideSvg()}</div>
  <ul class="passport__legend">
    <li><span class="swatch is-first"></span>First recorded at #1</li>
    <li><span class="swatch is-latest"></span>First recorded at #4</li>
  </ul>
  <ol class="passport-timeline" aria-label="What each handover showed of the dent's spot">
    ${EXAMPLE_HANDOVERS.map(
      (
        h,
      ) => html`<li class="passport-timeline__item is-${h.dentSpot}${inWindow(h) ? ' is-in-window' : ''}">
      <span class="passport-timeline__marker">${icon(EVIDENCE[h.dentSpot].icon)}</span>
      <span class="passport-timeline__what"><strong>#${h.sequence} ${eventName(h)}</strong> · ${h.place} · <time datetime="${h.date}">${shortDate(h.date)}</time></span>
      <span class="passport-timeline__evidence">${EVIDENCE[h.dentSpot].text}</span>
    </li>`,
    )}
  </ol>
  <figcaption class="passport__verdict">
    <strong>Where did it happen?</strong> Between #${lastClean.sequence} and #${recorded.sequence}: on the train to Łódź or at the Łódź terminal.
    ${unseen.map((h) => html`#${h.sequence} had no photo of the spot, so the dent may be older than #${h.sequence}.`)}
  </figcaption>
</figure>`;
}

// The sealed chain ---------------------------------------------------------

/** The four sealed handovers, each hash becoming the next record's previous hash. */
export function chainFigure(): Html {
  const cardX = 10;
  const cardWidth = 380;
  const cardHeight = 96;
  const gap = 36;
  const prevX = cardX + 60;
  const hashX = cardX + 228;
  const top = (index: number) => 8 + index * (cardHeight + gap);
  const height = top(EXAMPLE_HANDOVERS.length) - gap + 8;
  const latest = EXAMPLE_HANDOVERS.length - 1;

  const card = (h: ExampleHandover, index: number) => {
    const y = top(index);
    return html`<g class="chain-card${index === latest ? ' is-latest' : ''}">
    <rect class="chain-card__box" x="${cardX}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="10"></rect>
    <circle class="chain-card__seal" cx="${cardX + 32}" cy="${y + 32}" r="17"></circle>
    <text class="chain-card__number" x="${cardX + 32}" y="${y + 37}" text-anchor="middle">${h.sequence}</text>
    <text class="chain-card__title" x="${prevX}" y="${y + 29}">${eventName(h)} · ${h.place}</text>
    <text class="chain-card__meta" x="${prevX}" y="${y + 49}">${shortDate(h.date)} · ${h.transport}</text>
    <text class="chain-card__hash" x="${prevX}" y="${y + 77}"><tspan class="chain-card__key">prev </tspan><tspan class="${index > 0 ? 'chain-card__linked' : ''}">${shortHash(h.previousHash)}</tspan></text>
    <text class="chain-card__hash" x="${hashX}" y="${y + 77}"><tspan class="chain-card__key">hash </tspan><tspan class="chain-card__linked">${shortHash(h.hash)}</tspan></text>
  </g>`;
  };

  const link = (index: number) => {
    const from = { x: hashX + 70, y: top(index) + cardHeight };
    const to = { x: prevX + 70, y: top(index + 1) };
    const mid = (from.y + to.y) / 2;
    return html`<path class="chain-link" d="M${from.x} ${from.y} C${from.x} ${mid} ${to.x} ${mid} ${to.x} ${to.y - 6}"></path>
    <path class="chain-link__head" d="M${to.x - 5} ${to.y - 11} L${to.x} ${to.y - 4} L${to.x + 5} ${to.y - 11}"></path>`;
  };

  return html`<figure class="chain">
  <svg class="chain__svg" viewBox="0 0 400 ${height}" role="img" aria-labelledby="chain-title">
    <title id="chain-title">Four sealed handovers of container ${CONTAINER.display}. Each record's hash is carried into the next record as its previous hash, so changing an earlier record breaks every hash after it.</title>
    ${EXAMPLE_HANDOVERS.slice(0, -1).map((_, i) => link(i))}
    ${EXAMPLE_HANDOVERS.map(card)}
  </svg>
  <figcaption>Each record's SHA-256 covers the previous record's hash, so the history is checked from the first handover to the last.</figcaption>
</figure>`;
}

// A spoken damage note -----------------------------------------------------

export function voiceFigure(): Html {
  return html`<figure class="voice">
  <div class="voice__said">
    <p class="voice__label">${icon('mic')}Said at the gate</p>
    <blockquote class="voice__quote" lang="pl"><p>„Wgniecenie, lewy bok, sekcja trzecia, na dole.”</p></blockquote>
    <p class="voice__translation">“Dent, left side, section three, at the bottom.”</p>
  </div>
  <div class="voice__arrow" aria-hidden="true">${icon('arrow-right')}</div>
  <div class="voice__coded">
    <p class="voice__label">${icon('list-checks')}Proposed to the checker</p>
    <dl class="voice__codes">
      <div><dt>Location</dt><dd><code>${DENT.location}</code> Left side, section 3, lower half</dd></div>
      <div><dt>Damage</dt><dd><code>${DENT.damage}</code> ${DENT.damageName}</dd></div>
      <div><dt>Mark</dt><dd>Drawn on section 3 of the left side, for the checker to confirm</dd></div>
    </dl>
  </div>
  <figcaption>Muse Voice Transcribe writes the note down; Muse Spark codes it onto the section named.</figcaption>
</figure>`;
}

// A container's journey ----------------------------------------------------

const JOURNEY: readonly { icon: IconName; label: string }[] = [
  { icon: 'ship', label: 'Ship' },
  { icon: 'anchor', label: 'Port terminal' },
  { icon: 'train-front', label: 'Train' },
  { icon: 'warehouse', label: 'Inland terminal' },
  { icon: 'truck', label: 'Truck' },
  { icon: 'container', label: 'Depot' },
];

export function journeyFigure(): Html {
  return html`<figure class="journey">
  <ol class="journey__stops">
    ${JOURNEY.map((stop) => html`<li class="journey__stop"><span class="journey__icon">${icon(stop.icon)}</span><span>${stop.label}</span></li>`)}
  </ol>
  <figcaption class="journey__caption"><span class="journey__seal" aria-hidden="true"></span>Each step is a handover. Liability for damage moves with the container.</figcaption>
</figure>`;
}
