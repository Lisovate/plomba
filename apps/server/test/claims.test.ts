import type { Claim } from '@plomba/contracts';
import { describe, expect, it } from 'vitest';
import {
  SqliteContainerRepository,
  SqliteHandoverRepository,
  SqliteMarkRepository,
  SqlitePhotoRepository,
} from '../src/adapters/sqlite/repositories.ts';
import { ConflictError, UpstreamError } from '../src/errors.ts';
import { ClaimService } from '../src/services/claims.ts';
import {
  createTestHandoverService,
  makePhoto,
  markInput,
  rectangleObject,
  ScriptedAgent,
} from './fakes.ts';

const NUMBER = 'CSQU3054383';

/** Gate-in at Gdynia with one dent; gate-out at Łódź where the dent is still there and a hole is new. */
async function twoHandovers() {
  const context = createTestHandoverService();
  const { service, segmenter } = context;
  segmenter.responses.set('shipping container', [rectangleObject(0, 0, 400, 300)]);
  service.registerContainer({ number: NUMBER, sizeTypeCode: '22G1' });
  const first = service.start({
    containerNumber: NUMBER,
    direction: 'in',
    place: 'Gdynia',
    checker: 'PL',
    sealNumbers: [],
  });
  const dent = service.addMark(
    first.id,
    markInput({ damageCode: 'DT', rect: { u0: 1, v0: 1, u1: 1.2, v1: 1.2 } }),
  );
  await service.close(first.id, { acceptGaps: true });

  const second = service.start({
    containerNumber: NUMBER,
    direction: 'out',
    place: 'Łódź',
    checker: 'AN',
    handedOverBy: 'Trans-Kontener',
    sealNumbers: [],
  });
  const photo = await service.addPhoto(second.id, { face: 'R', data: await makePhoto() });
  service.addMark(
    second.id,
    markInput({
      damageCode: 'DT',
      rect: dent.rect,
      status: 'still-there',
      previousMarkId: dent.id,
    }),
  );
  const hole = service.addMark(
    second.id,
    markInput({ damageCode: 'HO', rect: { u0: 3, v0: 0.2, u1: 3.2, v1: 0.4 }, photoId: photo.id }),
  );
  return { ...context, first, second, hole, photo };
}

function claimService(context: Awaited<ReturnType<typeof twoHandovers>>, agent: ScriptedAgent) {
  return new ClaimService({
    containers: new SqliteContainerRepository(context.db),
    handovers: new SqliteHandoverRepository(context.db),
    photos: new SqlitePhotoRepository(context.db),
    marks: new SqliteMarkRepository(context.db),
    media: context.media,
    agent,
  });
}

describe('ClaimService', () => {
  it('sends a draft with wrong evidence back to the agent until it matches the records', async () => {
    const context = await twoHandovers();
    const sealed = await context.service.close(context.second.id, { acceptGaps: true });
    const firstHash = context.service.detail(context.first.id).handover.seal?.hash ?? '';
    const secondHash = sealed.seal?.hash ?? '';

    const draft = (items: Claim['items'], letter: string): Claim => ({
      addressee: 'Trans-Kontener',
      subject: `Damage to ${NUMBER}`,
      summary: 'A hole was found at gate-out.',
      items,
      letter,
    });
    const agent = new ScriptedAgent([
      // A made-up mark and a wrong code, and no record hashes.
      () =>
        draft(
          [
            {
              markId: 'invented',
              locationCode: 'LT1N',
              damageCode: 'DT',
              description: 'dent',
              photoSha256: null,
            },
            {
              markId: context.hole.id,
              locationCode: 'RB3N',
              damageCode: 'DT',
              description: 'hole',
              photoSha256: context.photo.sha256,
            },
          ],
          `Container ${NUMBER} has a new hole.`,
        ),
      () =>
        draft(
          [
            {
              markId: context.hole.id,
              locationCode: context.hole.locationCode,
              damageCode: 'HO',
              description: 'hole in the right side panel',
              photoSha256: context.photo.sha256,
            },
          ],
          `Container ${NUMBER}: new hole. Records ${firstHash} and ${secondHash}.`,
        ),
    ]);

    const result = await claimService(context, agent).draft(context.second.id, 'en');

    expect(result.status).toBe('drafted');
    if (result.status !== 'drafted') return;
    expect(result.verification.attempts).toBe(2);
    expect(result.verification.toolCalls).toEqual([
      'get_handover_comparison',
      'get_container_history',
    ]);
    expect(agent.feedback).toHaveLength(1);
    expect(agent.feedback[0]).toContain('invented is not new damage');
    expect(agent.feedback[0]).toContain(
      `the record says location ${context.hole.locationCode} and damage HO`,
    );
    expect(agent.feedback[0]).toContain('cite both record hashes');
    expect(agent.tasks[0]?.images).toHaveLength(1);

    const [comparison, history] = agent.toolResults as [
      { newDamage: { markId: string }[]; earlierDamageNow: { status: string }[] },
      { chainIntact: boolean; handovers: unknown[] },
    ];
    expect(comparison.newDamage.map((m) => m.markId)).toEqual([context.hole.id]);
    expect(comparison.earlierDamageNow.map((m) => m.status)).toEqual(['still-there']);
    expect(history).toMatchObject({ chainIntact: true });
    expect(history.handovers).toHaveLength(2);
  });

  it('gives up when the drafts keep failing verification', async () => {
    const context = await twoHandovers();
    await context.service.close(context.second.id, { acceptGaps: true });
    const bad = () => ({ addressee: 'X', subject: 's', summary: 's', items: [], letter: '' });
    const agent = new ScriptedAgent([bad, bad, bad]);
    await expect(claimService(context, agent).draft(context.second.id, 'pl')).rejects.toThrow(
      UpstreamError,
    );
  });

  it('needs a sealed handover and reports when nothing is new', async () => {
    const context = await twoHandovers();
    const service = claimService(context, new ScriptedAgent([]));
    await expect(service.draft(context.second.id, 'en')).rejects.toThrow(ConflictError);
    expect(await service.draft(context.first.id, 'en')).toMatchObject({ status: 'no-new-damage' });
  });
});
