/**
 * One container's journey, recorded through the API as the app records it,
 * so the examples have real sealed records to work on. Everything here is
 * invented: the PLBU owner code, the numbers, companies, trucks and wagons.
 *
 * PLBU 400004 3 (42G1, 40 ft), leased by its owner to a shipper:
 *
 * 1. Gdynia container terminal, gate out by road on truck EL 4K217 (the
 *    on-hire survey). Doors, both sides and the front photographed; the roof
 *    is not. Rust on the left side is recorded.
 * 2. Łódź inland terminal, gate in from the same truck. The rust is still
 *    there; a new dent on the right side, on a spot photographed clean at
 *    Gdynia. It happened on the road leg.
 * 3. Łódź inland terminal, gate out by rail on wagon 33 51 4556 012-4 (the
 *    off-hire survey). The rust was repaired and the dent is still there.
 *    New: a bent locking bar on the doors (clean at the gate in), a second
 *    dent overlapping the first one but not linked to it, and a hole in the
 *    roof, which no handover has photographed.
 *
 * Two more containers keep the fleet and the truck search honest:
 * PLBU 400005 9, sealed at Łódź from another truck, and PLBU 400006 4,
 * whose gate in from EL 4K217 is still open.
 */

import type { CreateMarkInput, Face, Handover, Mark, StartHandoverInput } from '@plomba/contracts';
import { makePhoto } from '../../apps/server/test/fakes.ts';
import type { PlombaClient } from '../shared/client.ts';

export const CONTAINER = 'PLBU4000043';
export const OTHER_TRUCK_CONTAINER = 'PLBU4000059';
export const OPEN_CONTAINER = 'PLBU4000064';
export const TRUCK = 'EL 4K217';
export const OTHER_TRUCK = 'LD 5520C';
export const WAGON = '335145560124';

export interface Journey {
  readonly handovers: {
    readonly gdynia: Handover;
    readonly lodzIn: Handover;
    readonly lodzOut: Handover;
    readonly otherTruck: Handover;
    readonly stillOpen: Handover;
  };
  /** The mark that first recorded each damage. */
  readonly damage: {
    /** Left side, at Gdynia; repaired by the rail gate out. */
    readonly rust: Mark;
    /** Right side, new at the Łódź gate in; clean at Gdynia. */
    readonly dent: Mark;
    /** Doors, new at the Łódź gate out; clean at the gate in. */
    readonly lockingBar: Mark;
    /** Right side, new at the gate out, on top of the earlier dent without being linked to it. */
    readonly secondDent: Mark;
    /** Roof, new at the gate out; no handover photographed the roof. */
    readonly roofHole: Mark;
  };
}

const PHOTO_SIZE = { width: 400, height: 300 } as const;

export async function recordJourney(client: PlombaClient): Promise<Journey> {
  const photo = await makePhoto(PHOTO_SIZE.width, PHOTO_SIZE.height);
  await client.registerContainer({ number: CONTAINER, sizeTypeCode: '42G1' });
  await client.registerContainer({ number: OTHER_TRUCK_CONTAINER, sizeTypeCode: '22G1' });
  await client.registerContainer({ number: OPEN_CONTAINER, sizeTypeCode: '45G1' });

  /** Photographs each face whole: its corners are the photo's corners. */
  const photograph = async (handover: Handover, faces: readonly Face[]) => {
    for (const face of faces) {
      const added = await client.addPhoto(handover.id, face, photo);
      const { width: w, height: h } = PHOTO_SIZE;
      await client.setPhotoCorners(handover.id, added.id, [
        { x: 1, y: 1 },
        { x: w - 1, y: 1 },
        { x: w - 1, y: h - 1 },
        { x: 1, y: h - 1 },
      ]);
    }
  };
  const mark = (handover: Handover, input: CreateMarkInput) =>
    client.addMark(handover.id, { source: 'confirmed', ...input });
  const seal = (handover: Handover) => client.closeHandover(handover.id, { acceptGaps: true });

  const base = { containerNumber: CONTAINER, sealNumbers: ['PL 0412377'] };
  const rustRect = { u0: 2.0, v0: 0.3, u1: 2.6, v1: 0.9 };
  const dentRect = { u0: 5.0, v0: 1.0, u1: 5.6, v1: 1.5 };

  // 1. Gdynia, gate out by road: the on-hire survey.
  const gdynia = await client.startHandover({
    ...base,
    direction: 'out',
    place: 'Gdynia container terminal',
    checker: 'K. Wiśniewska',
    handedOverBy: 'Gdynia container terminal',
    receivedBy: 'Kociewie Trans',
    transportMode: 'road',
    vehicleId: TRUCK,
  });
  await photograph(gdynia, ['D', 'R', 'F', 'L']);
  const rust = await mark(gdynia, {
    face: 'L',
    rect: rustRect,
    damageCode: 'CO',
    componentCode: 'PAA',
    note: 'Surface rust on the lower panel',
  });
  const gdyniaSealed = await seal(gdynia);

  // 2. Łódź, gate in from the same truck: the rust confirmed, a new dent.
  const lodzIn = await client.startHandover({
    ...base,
    direction: 'in',
    place: 'Łódź inland terminal',
    checker: 'A. Nowak',
    handedOverBy: 'Kociewie Trans',
    receivedBy: 'Łódź inland terminal',
    transportMode: 'road',
    vehicleId: TRUCK,
  });
  await photograph(lodzIn, ['D', 'R', 'F', 'L']);
  const rustAtLodz = await mark(lodzIn, {
    face: 'L',
    rect: rustRect,
    damageCode: 'CO',
    componentCode: 'PAA',
    status: 'still-there',
    previousMarkId: rust.id,
  });
  const dent = await mark(lodzIn, {
    face: 'R',
    rect: dentRect,
    damageCode: 'DT',
    componentCode: 'PAA',
    note: 'Dent about 30 cm across',
  });
  const lodzInSealed = await seal(lodzIn);

  // 3. Łódź, gate out by rail: the off-hire survey.
  const lodzOut = await client.startHandover({
    ...base,
    direction: 'out',
    place: 'Łódź inland terminal',
    checker: 'A. Nowak',
    handedOverBy: 'Łódź inland terminal',
    receivedBy: 'Vistula Rail',
    transportMode: 'rail',
    vehicleId: WAGON,
  });
  await photograph(lodzOut, ['D', 'R', 'L']);
  await mark(lodzOut, {
    face: 'L',
    rect: rustRect,
    damageCode: 'CO',
    componentCode: 'PAA',
    status: 'repaired',
    previousMarkId: rustAtLodz.id,
  });
  await mark(lodzOut, {
    face: 'R',
    rect: dentRect,
    damageCode: 'DT',
    componentCode: 'PAA',
    status: 'still-there',
    previousMarkId: dent.id,
  });
  const lockingBar = await mark(lodzOut, {
    face: 'D',
    rect: { u0: 0.9, v0: 1.0, u1: 1.2, v1: 1.6 },
    damageCode: 'BT',
    componentCode: 'LBA',
    note: 'Right-hand locking bar bent',
  });
  const secondDent = await mark(lodzOut, {
    face: 'R',
    rect: { u0: 5.4, v0: 1.2, u1: 5.9, v1: 1.6 },
    damageCode: 'DT',
    componentCode: 'PAA',
    note: 'Dent next to the one recorded at gate in',
  });
  const roofHole = await mark(lodzOut, {
    face: 'T',
    rect: { u0: 6.0, v0: 1.0, u1: 6.3, v1: 1.3 },
    damageCode: 'HO',
    componentCode: 'PAA',
    note: 'Seen from the crane cab',
  });
  const lodzOutSealed = await seal(lodzOut);

  // Another container from another truck, sealed with no damage.
  const otherTruck = await seal(
    await client.startHandover({
      containerNumber: OTHER_TRUCK_CONTAINER,
      direction: 'in',
      place: 'Łódź inland terminal',
      checker: 'A. Nowak',
      transportMode: 'road',
      vehicleId: OTHER_TRUCK,
    } satisfies StartHandoverInput),
  );

  // The first truck's next delivery: started, not sealed yet.
  const stillOpen = await client.startHandover({
    containerNumber: OPEN_CONTAINER,
    direction: 'in',
    place: 'Łódź inland terminal',
    checker: 'A. Nowak',
    transportMode: 'road',
    vehicleId: TRUCK,
  });

  return {
    handovers: {
      gdynia: gdyniaSealed,
      lodzIn: lodzInSealed,
      lodzOut: lodzOutSealed,
      otherTruck,
      stillOpen,
    },
    damage: { rust, dent, lockingBar, secondDent, roofHole },
  };
}
