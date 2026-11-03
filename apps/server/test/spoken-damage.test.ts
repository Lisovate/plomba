import { SpokenDamageResultSchema } from '@plomba/contracts';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../src/errors.ts';
import { SpeechService } from '../src/services/speech.ts';
import { SpokenDamageService } from '../src/services/spoken-damage.ts';
import {
  createTestApp,
  createTestHandoverService,
  FakeDamageNoteParser,
  FakeTranscriber,
  makeWav,
} from './fakes.ts';

const NUMBER = 'CSQU3054383';

function setUp(parser: FakeDamageNoteParser) {
  const context = createTestHandoverService();
  context.service.registerContainer({ number: NUMBER, sizeTypeCode: '22G1' });
  const handover = context.service.start({
    containerNumber: NUMBER,
    direction: 'in',
    place: 'Gdynia rail terminal',
    checker: 'P. Lisowski',
    sealNumbers: [],
  });
  const spoken = new SpokenDamageService({
    speech: new SpeechService(new FakeTranscriber()),
    parser,
    handovers: context.service,
  });
  return { ...context, handover, spoken };
}

describe('SpokenDamageService', () => {
  it('turns a spoken note into proposals on the sections named', async () => {
    const parser = new FakeDamageNoteParser([
      {
        face: 'L',
        location: { from: 3, to: 3, half: 'lower' },
        damageCode: 'DT',
        componentCode: 'PAA',
        note: 'wgniecenie, około 30 cm',
      },
    ]);
    const { spoken, handover, service } = setUp(parser);

    const result = await spoken.record(handover.id, 'D', makeWav());

    expect(parser.texts).toEqual(['wgniecenie przy drzwiach']);
    expect(result.transcript).toBe('wgniecenie przy drzwiach');
    expect(result.marks.map((m) => [m.locationCode, m.damageCode, m.source])).toEqual([
      ['LB3N', 'DT', 'proposed'],
    ]);
    // Proposals wait for the checker, like damage the models find on photos.
    await expect(service.close(handover.id, { acceptGaps: true })).rejects.toThrow(ConflictError);
  });

  it("reports damage it can't place instead of guessing where it is", async () => {
    const parser = new FakeDamageNoteParser([
      { face: 'R', location: null, damageCode: 'HO', componentCode: null, note: 'dziura' },
      // A 20 ft side has five sections.
      {
        face: 'R',
        location: { from: 7, to: 7, half: null },
        damageCode: 'CO',
        componentCode: null,
        note: 'rdza w siódmej sekcji',
      },
    ]);
    const { spoken, handover } = setUp(parser);

    const result = await spoken.record(handover.id, 'R', makeWav());

    expect(result.marks).toEqual([]);
    expect(result.unplaced).toEqual(['dziura', 'rdza w siódmej sekcji']);
  });

  it('refuses a sealed handover before calling any model', async () => {
    const parser = new FakeDamageNoteParser();
    const { spoken, handover, service } = setUp(parser);
    await service.close(handover.id, { acceptGaps: true });

    await expect(spoken.record(handover.id, 'D', makeWav())).rejects.toThrow(ConflictError);
    expect(parser.texts).toEqual([]);
  });
});

describe('POST /api/handovers/:id/spoken-damage', () => {
  it('takes the recording and the face in view', async () => {
    const parser = new FakeDamageNoteParser([
      {
        face: 'D',
        location: { from: 2, to: 3, half: 'lower' },
        damageCode: 'BT',
        componentCode: 'LBA',
        note: 'wygięty rygiel',
      },
    ]);
    const { app, service } = createTestApp({ noteParser: parser });
    service.registerContainer({ number: NUMBER, sizeTypeCode: '22G1' });
    const handover = service.start({
      containerNumber: NUMBER,
      direction: 'out',
      place: 'Łódź',
      checker: 'A. Nowak',
      sealNumbers: [],
    });
    const form = new FormData();
    form.set('face', 'D');
    form.set('audio', new File([makeWav() as Uint8Array<ArrayBuffer>], 'note.wav'));

    const response = await app.request(`/api/handovers/${handover.id}/spoken-damage`, {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(200);
    const result = SpokenDamageResultSchema.parse(await response.json());
    expect(result.marks[0]?.locationCode).toBe('DB23');
  });

  it('needs a face', async () => {
    const { app } = createTestApp();
    const form = new FormData();
    form.set('audio', new File([makeWav() as Uint8Array<ArrayBuffer>], 'note.wav'));
    const response = await app.request('/api/handovers/x/spoken-damage', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(400);
  });
});
