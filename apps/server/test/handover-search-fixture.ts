import { StartHandoverSchema } from '@plomba/contracts';
import { SqliteHandoverRepository } from '../src/adapters/sqlite/repositories.ts';
import { createTestApp } from './fakes.ts';

export async function handoverSearchFixture() {
  const context = createTestApp();
  const { service, db } = context;
  service.registerContainer({ number: 'CSQU3054383' });
  service.registerContainer({ number: 'MSCU9749070' });
  const start = (container: string, vehicle: string, place: string, direction: 'in' | 'out') =>
    service.start(
      StartHandoverSchema.parse({
        containerNumber: container,
        vehicleId: vehicle,
        transportMode: 'road',
        place,
        direction,
        checker: 'Gate checker',
      }),
    );
  const older = await service.close(start('CSQU3054383', 'EL-4K217', 'Gdynia', 'out').id, {
    acceptGaps: true,
  });
  const tiedA = await service.close(start('CSQU3054383', 'EL4K217', 'Łódź', 'in').id, {
    acceptGaps: true,
  });
  const tiedB = await service.close(start('MSCU9749070', 'EL 4K217', 'Gdynia', 'out').id, {
    acceptGaps: true,
  });
  db.prepare('UPDATE handovers SET started_at = ? WHERE id = ?').run(tiedA.startedAt, tiedB.id);
  const openTruck = start('CSQU3054383', 'EL 4K217', 'Gdynia', 'in');
  const otherTruck = await service.close(start('MSCU9749070', 'WX 00000', 'Gdynia', 'out').id, {
    acceptGaps: true,
  });
  const wagon = service.start(
    StartHandoverSchema.parse({
      containerNumber: 'MSCU9749070',
      vehicleId: '335145560124',
      transportMode: 'rail',
      place: 'Rail terminal',
      direction: 'in',
      checker: 'Gate checker',
    }),
  );
  const repository = new SqliteHandoverRepository(db);
  return {
    ...context,
    repository,
    older,
    tiedA,
    tiedB,
    openTruck,
    otherTruck,
    wagon,
    newestFirst: [wagon.id, otherTruck.id, openTruck.id, tiedB.id, tiedA.id, older.id],
  };
}
