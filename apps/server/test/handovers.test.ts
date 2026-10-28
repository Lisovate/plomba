import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors.ts';
import { createTestHandoverService, makePhoto, markInput, rectangleObject } from './fakes.ts';

const NUMBER = 'CSQU3054383';

async function startedHandover() {
  const context = createTestHandoverService();
  context.service.registerContainer({ number: NUMBER, sizeTypeCode: '22G1' });
  const handover = context.service.start({
    containerNumber: NUMBER,
    direction: 'in',
    place: 'Gdynia rail terminal',
    checker: 'P. Lisowski',
    sealNumbers: ['ML123456'],
  });
  return { ...context, handover };
}

describe('registerContainer', () => {
  it('rejects a number that fails the check digit', () => {
    const { service } = createTestHandoverService();
    expect(() => service.registerContainer({ number: 'CSQU3054384' })).toThrow(ValidationError);
  });

  it('takes dimensions from the size and type code, and is idempotent', () => {
    const { service } = createTestHandoverService();
    const first = service.registerContainer({ number: 'csqu 305438 3', sizeTypeCode: '22G1' });
    expect(first.number).toBe(NUMBER);
    expect(first.dimensions.length).toBeCloseTo(6.058);
    expect(service.registerContainer({ number: NUMBER })).toEqual(first);
  });
});

describe('a handover', () => {
  it('allows only one open handover per container', async () => {
    const { service } = await startedHandover();
    expect(() =>
      service.start({
        containerNumber: NUMBER,
        direction: 'out',
        place: 'x',
        checker: 'y',
        sealNumbers: [],
      }),
    ).toThrow(ConflictError);
  });

  it('blurs privacy regions and detects the face corners of a photo', async () => {
    const { service, segmenter, media, handover } = await startedHandover();
    segmenter.responses.set('shipping container', [rectangleObject(40, 30, 360, 270)]);
    segmenter.responses.set('license plate', [rectangleObject(10, 10, 60, 30)]);

    const photo = await service.addPhoto(handover.id, { face: 'R', data: await makePhoto() });

    expect(segmenter.calls.sort()).toEqual(['human face', 'license plate', 'shipping container']);
    expect(photo.redactedRegions).toBe(1);
    expect(photo.cornersSource).toBe('detected');
    expect(photo.corners?.[0]).toEqual({ x: 40, y: 30.5 });
    expect(media.files.has(photo.sha256)).toBe(true);
    expect(photo.url).toBe(`/media/${photo.sha256}`);
  });

  it('leaves corners for the checker when no container is found', async () => {
    const { service, handover } = await startedHandover();
    const photo = await service.addPhoto(handover.id, { face: 'D', data: await makePhoto() });
    expect(photo.corners).toBeNull();
    const adjusted = service.updateCorners(handover.id, photo.id, [
      { x: 1, y: 1 },
      { x: 399, y: 1 },
      { x: 399, y: 299 },
      { x: 1, y: 299 },
    ]);
    expect(adjusted.cornersSource).toBe('adjusted');
  });

  it('codes a mark from its position on the face', async () => {
    const { service, handover } = await startedHandover();
    const mark = service.addMark(
      handover.id,
      markInput({
        face: 'R',
        rect: { u0: 0.2, v0: 0.2, u1: 0.5, v1: 0.6 },
        damageCode: 'DT',
        componentCode: 'PAA',
      }),
    );
    expect(mark.locationCode).toBe('RB1N');

    const moved = service.updateMark(handover.id, mark.id, {
      rect: { u0: 5.5, v0: 1.6, u1: 5.9, v1: 2.0 },
    });
    expect(moved.locationCode).toBe('RT5N');
  });

  it('seals handovers into a verifiable chain and carries marks forward', async () => {
    const { service, db, handover } = await startedHandover();
    const dent = service.addMark(
      handover.id,
      markInput({ face: 'L', rect: { u0: 1, v0: 1, u1: 1.3, v1: 1.2 }, damageCode: 'DT' }),
    );
    const first = await service.close(handover.id, { acceptGaps: true });
    expect(first.status).toBe('closed');
    expect(first.seal?.sequence).toBe(0);
    await expect(service.close(handover.id, { acceptGaps: true })).rejects.toThrow(ConflictError);

    const second = service.start({
      containerNumber: NUMBER,
      direction: 'out',
      place: 'Łódź inland terminal',
      checker: 'A. Nowak',
      sealNumbers: [],
    });
    const detail = service.detail(second.id);
    expect(second.previousHandoverId).toBe(handover.id);
    expect(detail.previousMarks.map((m) => m.id)).toEqual([dent.id]);

    service.addMark(
      second.id,
      markInput({
        face: 'L',
        rect: dent.rect,
        damageCode: 'DT',
        status: 'still-there',
        previousMarkId: dent.id,
      }),
    );
    const sealed = await service.close(second.id, { acceptGaps: true });
    expect(sealed.seal?.previousHash).toBe(first.seal?.hash);

    const history = await service.history(NUMBER);
    expect(history.chain).toEqual({ ok: true, length: 2, brokenAt: null });

    // Quietly editing a sealed record breaks the chain at that record.
    db.prepare(`UPDATE handovers SET record = replace(record, '"DT"', '"CO"') WHERE id = ?`).run(
      handover.id,
    );
    expect((await service.history(NUMBER)).chain).toEqual({ ok: false, length: 2, brokenAt: 0 });
  });

  it('rejects marks that point at the wrong previous handover', async () => {
    const { service, handover } = await startedHandover();
    expect(() =>
      service.addMark(
        handover.id,
        markInput({
          face: 'R',
          rect: { u0: 0, v0: 0, u1: 1, v1: 1 },
          status: 'still-there',
          previousMarkId: '00000000-0000-4000-8000-0000000000ff',
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('lists open handovers first, with counts', async () => {
    const { service, handover } = await startedHandover();
    await service.addPhoto(handover.id, { face: 'D', data: await makePhoto() });
    const [first] = service.recent();
    expect(first).toMatchObject({ id: handover.id, status: 'open', photoCount: 1, markCount: 0 });
  });

  it('reports unknown handovers and containers', async () => {
    const { service } = createTestHandoverService();
    expect(() => service.detail('00000000-0000-4000-8000-0000000000ff')).toThrow(NotFoundError);
    await expect(service.history('CSQU3054383')).rejects.toThrow(NotFoundError);
  });
});

describe('damage proposals', () => {
  // A 400×300 photo in which the right side of a 20 ft container fills x 40–360, y 30–270.
  async function registeredPhoto() {
    const context = await startedHandover();
    context.segmenter.responses.set('shipping container', [rectangleObject(40, 30, 360, 270)]);
    const photo = await context.service.addPhoto(context.handover.id, {
      face: 'R',
      data: await makePhoto(),
    });
    return { ...context, photo };
  }

  const dentNearDoors = {
    box: { left: 60, top: 200, right: 100, bottom: 250 },
    damageCode: 'DT',
    componentCode: 'PAA',
    description: 'dent near the doors',
    confidence: 0.9,
  } as const;

  it('maps findings onto the face as proposed marks and drops the rest', async () => {
    const { service, detector, handover, photo } = await registeredPhoto();
    detector.findings = [
      dentNearDoors,
      {
        ...dentNearDoors,
        box: { left: 0, top: 0, right: 30, bottom: 20 },
        description: 'off the container',
      },
      { ...dentNearDoors, box: { left: 200, top: 100, right: 220, bottom: 120 }, confidence: 0.1 },
    ];

    const proposals = await service.proposeDamage(handover.id, photo.id);

    expect(proposals).toHaveLength(1);
    const [dent] = proposals;
    expect(dent).toMatchObject({
      source: 'proposed',
      status: 'new',
      damageCode: 'DT',
      componentCode: 'PAA',
      photoId: photo.id,
      locationCode: 'RB1N',
    });
    expect(dent?.outline?.length).toBeGreaterThanOrEqual(3);
    expect(dent?.note).toBe('dent near the doors (Muse Spark 90%, outlined by SAM 3.1 at 80%)');
  });

  it('does not propose the same damage twice', async () => {
    const { service, detector, handover, photo } = await registeredPhoto();
    detector.findings = [dentNearDoors];
    expect(await service.proposeDamage(handover.id, photo.id)).toHaveLength(1);
    expect(await service.proposeDamage(handover.id, photo.id)).toEqual([]);
  });

  it("falls back to the model's box when SAM outlines nothing", async () => {
    const { service, segmenter, detector, handover, photo } = await registeredPhoto();
    segmenter.outlineBoxes = false;
    detector.findings = [dentNearDoors];
    const [dent] = await service.proposeDamage(handover.id, photo.id);
    expect(dent?.outline).toHaveLength(4);
    expect(dent?.note).toBe('dent near the doors (Muse Spark 90%)');
  });

  it('refuses to seal until every proposal is confirmed or rejected', async () => {
    const { service, detector, handover, photo } = await registeredPhoto();
    detector.findings = [dentNearDoors];
    const [dent] = await service.proposeDamage(handover.id, photo.id);
    await expect(service.close(handover.id, { acceptGaps: true })).rejects.toThrow(ConflictError);
    service.updateMark(handover.id, dent?.id ?? '', { source: 'confirmed' });
    await expect(service.close(handover.id, { acceptGaps: true })).resolves.toMatchObject({
      status: 'closed',
    });
  });

  it('needs the face corners first', async () => {
    const { service, handover } = await startedHandover();
    const photo = await service.addPhoto(handover.id, { face: 'D', data: await makePhoto() });
    await expect(service.proposeDamage(handover.id, photo.id)).rejects.toThrow(ConflictError);
  });
});

describe('gate report', () => {
  it('is issued only for a sealed handover, with its damage and record hash', async () => {
    const { service, handover } = await startedHandover();
    service.addMark(
      handover.id,
      markInput({
        rect: { u0: 0.2, v0: 0.2, u1: 0.5, v1: 0.6 },
        damageCode: 'DT',
        componentCode: 'PAA',
      }),
    );
    service.addMark(handover.id, markInput({ damageCode: 'CO', source: 'rejected' }));
    expect(() => service.codeco(handover.id, 'MSCU')).toThrow(ConflictError);

    const sealed = await service.close(handover.id, { acceptGaps: true });
    const { fileName, content } = service.codeco(handover.id, 'MSCU');

    expect(fileName).toBe('CODECO-CSQU3054383-1.edi');
    const lines = content.split('\n');
    expect(lines).toContain("BGM+34+CSQU3054383-1+9'");
    expect(lines).toContain("EQD+CN+CSQU3054383+22G1:102:5'");
    expect(lines).toContain("SEL+ML123456'");
    expect(lines.filter((l) => l.startsWith('DAM+'))).toEqual(["DAM+1+DT+RB1N'"]);
    expect(content).toContain((sealed.seal?.hash ?? '').toUpperCase());
  });
});

describe('coverage', () => {
  it('refuses to seal with unphotographed sections unless the gaps are accepted', async () => {
    const { service, segmenter, db, handover } = await startedHandover();
    // The right side fills the photo: all of its 10 sections are covered, no other face is.
    segmenter.responses.set('shipping container', [rectangleObject(0, 0, 400, 300)]);
    await service.addPhoto(handover.id, { face: 'R', data: await makePhoto() });

    const refused = await service.close(handover.id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).issues?.map((i) => i.path)).toEqual([
      'coverage.D',
      'coverage.F',
      'coverage.L',
      'coverage.T',
    ]);

    await service.close(handover.id, { acceptGaps: true });
    const row = db.prepare('SELECT record FROM handovers WHERE id = ?').get(handover.id) as {
      record: string;
    };
    const record = JSON.parse(row.record) as { notInspected: Record<string, string[]> };
    expect(Object.keys(record.notInspected)).toEqual(['D', 'F', 'L', 'T']);
    expect(record.notInspected.D).toHaveLength(8);
  });
});
