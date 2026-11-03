/**
 * Measures how well spoken damage notes are coded: each note, as Muse Voice
 * Transcribe would write it, goes through the same parser the app uses, and
 * the resulting CEDEX location and damage codes are compared with the
 * expected ones.
 *
 *   node --env-file=.env apps/server/scripts/eval-spoken-damage.ts
 *
 * The notes are typed by the author, in Polish and English, not recorded
 * speech: this measures the coding step alone. A 40 ft container (42G1);
 * `face` is the face the checker is looking at.
 */

import type { Face } from '@plomba/contracts';
import { locationCode, parseSizeType, sectionRect } from '@plomba/core';
import { pino } from 'pino';
import { MetaClient } from '../src/adapters/meta/client.ts';
import { MuseSparkDamageNoteParser } from '../src/adapters/meta/muse-spark.ts';
import { loadConfig } from '../src/config.ts';

interface Case {
  readonly face: Face;
  readonly note: string;
  /** Expected location and damage codes, e.g. "LB3N DT"; empty when the note describes no damage. */
  readonly expected: readonly string[];
}

const CASES: readonly Case[] = [
  { face: 'D', note: 'Wgniecenie na lewym boku, sekcja trzecia, dół.', expected: ['LB3N DT'] },
  { face: 'L', note: 'Dziura w panelu, sekcja siódma, góra.', expected: ['LT7N HO'] },
  {
    face: 'R',
    note: 'Prawy bok, sekcje od drugiej do czwartej, korozja na dole.',
    expected: ['RB24 CO'],
  },
  { face: 'T', note: 'Dach, sekcja piąta, lewa połowa, wgniecenie.', expected: ['TL5N DT'] },
  { face: 'D', note: 'Wygięty rygiel na drzwiach, sekcja druga, dół.', expected: ['DB2N BT'] },
  { face: 'F', note: 'Ściana czołowa, sekcja czwarta, pęknięcie na górze.', expected: ['FT4N CK'] },
  { face: 'L', note: 'Rozcięcie w sekcji dziesiątej, na całej wysokości.', expected: ['LX0N CU'] },
  { face: 'R', note: 'Dziura w dachu w sekcji pierwszej, prawa połowa.', expected: ['TR1N HO'] },
  {
    face: 'D',
    note: 'Wgniecenie na prawym boku w sekcji szóstej, góra i dół.',
    expected: ['RX6N DT'],
  },
  {
    face: 'L',
    note: 'Rdza wzdłuż całego dołu lewego boku, od pierwszej do dziesiątej sekcji.',
    expected: ['LBXX CO'],
  },
  { face: 'D', note: 'Dent on the right side, section five, lower half.', expected: ['RB5N DT'] },
  { face: 'L', note: 'Hole in section eight, top half.', expected: ['LT8N HO'] },
  {
    face: 'R',
    note: 'Corrosion on the roof, sections nine and ten, left half.',
    expected: ['TL90 CO'],
  },
  {
    face: 'F',
    note: 'Bent corner post on the front end, section one, bottom.',
    expected: ['FB1N BT'],
  },
  { face: 'D', note: 'Cut in the left door, section two, upper part.', expected: ['DT2N CU'] },
  { face: 'T', note: 'Dent in the roof, section three, right half.', expected: ['TR3N DT'] },
  {
    face: 'L',
    note: 'Broken bottom rail, sections four to six, lower half.',
    expected: ['LB46 BR'],
  },
  { face: 'R', note: 'Small hole, section seven, top.', expected: ['RT7N HO'] },
  {
    face: 'D',
    note: 'Wgniecenie, lewy bok, sekcja druga, dół. I dziura w dachu, sekcja czwarta, prawa połowa.',
    expected: ['LB2N DT', 'TR4N HO'],
  },
  { face: 'L', note: 'Tu wszystko w porządku, żadnych uszkodzeń.', expected: [] },
];

const config = loadConfig();
const { vision } = config.meta;
const client = new MetaClient({
  baseUrl: vision.baseUrl ?? config.meta.baseUrl,
  apiKey: vision.baseUrl ? (vision.apiKey ?? '') : config.meta.apiKey,
  timeoutMs: config.meta.timeoutMs,
  logger: pino({ level: 'warn' }),
});
const parser = new MuseSparkDamageNoteParser(client, {
  model: config.meta.visionModel,
  reasoningEffort: config.meta.reasoningEffort,
  api: vision.apiStyle,
});
const dimensions = parseSizeType('42G1')?.dimensions;
if (!dimensions) throw new Error('42G1 did not parse');

let exact = 0;
const latencies: number[] = [];
const rows: string[] = [];
for (const { face, note, expected } of CASES) {
  const started = performance.now();
  let got: string[];
  try {
    const items = await parser.parse(note, { face, dimensions });
    got = items.map((item) => {
      if (!item.location) return `unplaced ${item.damageCode}`;
      try {
        const rect = sectionRect(item.face, dimensions, item.location);
        return `${locationCode(item.face, rect, dimensions)} ${item.damageCode}`;
      } catch {
        return `invalid ${item.damageCode}`;
      }
    });
  } catch (error) {
    got = [`error: ${(error as Error).message}`];
  }
  latencies.push(performance.now() - started);
  const ok = [...got].sort().join(', ') === [...expected].sort().join(', ');
  if (ok) exact++;
  rows.push(
    `| ${face} | ${note} | ${expected.join(', ') || '—'} | ${got.join(', ') || '—'} | ${ok ? 'yes' : 'no'} |`,
  );
  process.stderr.write(`\r${rows.length}/${CASES.length}`);
}
latencies.sort((a, b) => a - b);
const p50 = ((latencies[Math.floor(latencies.length / 2)] ?? 0) / 1000).toFixed(1);

console.log(`\nModel: ${config.meta.visionModel} at ${vision.baseUrl ?? config.meta.baseUrl}

| Face in view | Note | Expected | Coded | Exact |
|---|---|---|---|---|
${rows.join('\n')}

**Exactly right:** ${exact} of ${CASES.length} notes (every location and damage code). Latency p50 ${p50} s.`);
