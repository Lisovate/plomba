import { type Claim, ProblemSchema } from '@plomba/contracts';
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
  createTestApp,
  createTestHandoverService,
  makePhoto,
  markInput,
  rectangleObject,
  ScriptedAgent,
} from './fakes.ts';

import { useLegacyRecord } from './legacy-record.ts';

const NUMBER = 'CSQU3054383';

/** Gate-in at Gdynia with one dent; gate-out at Łódź where the dent is still there and a hole is new. */
async function twoHandovers(context = createTestHandoverService()) {
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

function recordedClaim(context: Awaited<ReturnType<typeof twoHandovers>>): Claim {
  const firstHash = context.service.detail(context.first.id).handover.seal?.hash ?? '';
  const secondHash = context.service.detail(context.second.id).handover.seal?.hash ?? '';
  return {
    addressee: 'Trans-Kontener',
    subject: `Damage to ${NUMBER}`,
    summary: 'A hole was found at gate-out.',
    items: [
      {
        markId: context.hole.id,
        locationCode: context.hole.locationCode,
        damageCode: 'HO',
        description: 'hole in the right side panel',
        photoSha256: context.photo.sha256,
      },
    ],
    letter: `Container ${NUMBER}: new hole. Records ${firstHash} and ${secondHash}.`,
  };
}

describe('ClaimService', () => {
  it.each([1, 2] as const)(
    'drafts from version %i sealed records and reads their history',
    async (version) => {
      const context = await twoHandovers();
      await useLegacyRecord(context.db, context.first.id, version);
      await context.service.close(context.second.id, { acceptGaps: true });
      await useLegacyRecord(context.db, context.second.id, version);
      const recorded = recordedClaim(context);
      const agent = new ScriptedAgent([() => recorded]);
      await expect(
        claimService(context, agent).draft(context.second.id, 'en'),
      ).resolves.toMatchObject({
        status: 'drafted',
        claim: recorded,
      });
      expect(agent.toolResults[1]).toMatchObject({ chainIntact: true });
      expect((await context.service.history(NUMBER)).chain.ok).toBe(true);
      context.db.close();
    },
  );

  it.each([
    {
      fact: 'damage code',
      sql: "UPDATE marks SET damage_code = 'CO' WHERE handover_id = ? AND damage_code = 'HO'",
      changed: { damageCode: 'CO' },
    },
    {
      fact: 'location code',
      sql: "UPDATE marks SET location_code = 'LT1N' WHERE handover_id = ? AND damage_code = 'HO'",
      changed: { locationCode: 'LT1N' },
    },
    {
      fact: 'photo hash',
      sql: `UPDATE photos SET sha256 = '${'f'.repeat(64)}' WHERE handover_id = ?`,
      changed: { photoSha256: 'f'.repeat(64) },
    },
  ])('checks the sealed $fact even when the agent calls no tools', async ({ sql, changed }) => {
    const context = await twoHandovers();
    await context.service.close(context.second.id, { acceptGaps: true });
    const recorded = recordedClaim(context);
    context.db.prepare(sql).run(context.second.id);
    const agent = new ScriptedAgent(
      [
        () => ({ ...recorded, items: recorded.items.map((item) => ({ ...item, ...changed })) }),
        () => recorded,
      ],
      { callTools: false },
    );

    const result = await claimService(context, agent).draft(context.second.id, 'en');
    expect(result).toMatchObject({
      status: 'drafted',
      claim: recorded,
      verification: { attempts: 2, toolCalls: [] },
    });
    expect(agent.feedback).toHaveLength(1);
    expect((await context.service.history(NUMBER)).chain.ok).toBe(true);
  });

  it.each([
    "UPDATE marks SET source = 'rejected' WHERE handover_id = ?",
    "UPDATE marks SET status = 'repaired' WHERE handover_id = ?",
    'UPDATE handovers SET previous_handover_id = NULL WHERE id = ?',
  ])('keeps the sealed comparison after mutable rows change: %s', async (sql) => {
    const context = await twoHandovers();
    await context.service.close(context.second.id, { acceptGaps: true });
    const recorded = recordedClaim(context);
    context.db.prepare(sql).run(context.second.id);
    const agent = new ScriptedAgent([() => recorded], { callTools: false });

    await expect(
      claimService(context, agent).draft(context.second.id, 'en'),
    ).resolves.toMatchObject({
      status: 'drafted',
      claim: recorded,
      verification: { toolCalls: [] },
    });
  });

  it.each([
    `UPDATE handovers SET record = replace(record, 'Gdynia', 'Gdańsk') WHERE id = ?`,
    "UPDATE handovers SET record = '{' WHERE id = ?",
    `UPDATE handovers SET previous_hash = '${'f'.repeat(64)}' WHERE id = ?`,
  ])('refuses an invalid chain before starting the agent: %s', async (sql) => {
    const context = await twoHandovers();
    await context.service.close(context.second.id, { acceptGaps: true });
    const recorded = recordedClaim(context);
    context.db.prepare(sql).run(context.first.id);
    const agent = new ScriptedAgent([() => recorded], { callTools: false });

    await expect(claimService(context, agent).draft(context.second.id, 'en')).rejects.toThrow(
      new ConflictError('The container chain does not verify; a claim cannot be drafted'),
    );
    expect(agent.tasks).toEqual([]);
  });

  it('checks the chain even when there is no earlier handover to compare', async () => {
    const context = await twoHandovers();
    context.db
      .prepare(`UPDATE handovers SET record = replace(record, 'Gdynia', 'Gdańsk') WHERE id = ?`)
      .run(context.first.id);
    const agent = new ScriptedAgent([]);

    await expect(claimService(context, agent).draft(context.first.id, 'en')).rejects.toThrow(
      ConflictError,
    );
    expect(agent.tasks).toEqual([]);
  });

  it('returns a 409 problem response for a broken chain', async () => {
    const agent = new ScriptedAgent([], { callTools: false });
    const appContext = createTestApp({ agent });
    const context = await twoHandovers(appContext);
    await context.service.close(context.second.id, { acceptGaps: true });
    agent.answers.push(() => recordedClaim(context));
    context.db
      .prepare(`UPDATE handovers SET record = replace(record, 'Gdynia', 'Gdańsk') WHERE id = ?`)
      .run(context.first.id);

    const response = await appContext.app.request(`/api/handovers/${context.second.id}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en' }),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(ProblemSchema.parse(await response.json())).toMatchObject({
      status: 409,
      title: 'The container chain does not verify; a claim cannot be drafted',
    });
    expect(agent.tasks).toEqual([]);
  });

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
