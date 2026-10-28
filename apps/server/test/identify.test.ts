import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.ts';
import { IdentifyService } from '../src/services/identify.ts';
import { FakeReader, makePhoto } from './fakes.ts';

describe('IdentifyService', () => {
  it('verifies a correct read without asking again', async () => {
    const reader = new FakeReader('CSQU 305438 3');
    const result = await new IdentifyService(reader).identify(await makePhoto());
    expect(result.verdict).toBe('verified');
    expect(result.containerNumber).toBe('CSQU3054383');
    expect(reader.chooseCalls).toEqual([]);
  });

  it('corrects the only valid look-alike repair without asking again', async () => {
    // "CSQU 3O5438 3": a zero read as the letter O in the serial.
    const reader = new FakeReader('CSQU3O54383');
    const result = await new IdentifyService(reader).identify(await makePhoto());
    expect(result.verdict).toBe('corrected');
    expect(result.containerNumber).toBe('CSQU3054383');
    expect(result.explanation).toContain('O → 0 at position 6');
    expect(reader.chooseCalls).toEqual([]);
  });

  it('asks the model to pick between valid repairs (a real Muse Spark read of LSCU 107737 9)', async () => {
    const reader = new FakeReader('LSOU1077379');
    reader.choice = 'LSCU1077379';
    const result = await new IdentifyService(reader).identify(await makePhoto());
    // O→C, U→J, 7→2 and 0→8 each give a valid number with one change.
    expect(reader.chooseCalls[0]).toEqual(
      expect.arrayContaining(['LSCU1077379', 'LSOJ1077379', 'LSOU1077329', 'LSOU1877379']),
    );
    expect(result.verdict).toBe('corrected');
    expect(result.containerNumber).toBe('LSCU1077379');
  });

  it('asks the model to choose between equally close repairs', async () => {
    // A wrong check digit has several one-character repairs.
    const reader = new FakeReader('CSQU3054388');
    const service = new IdentifyService(reader);
    const ambiguous = await service.identify(await makePhoto());
    expect(reader.chooseCalls).toHaveLength(1);
    expect(ambiguous.verdict).toBe('ambiguous');
    expect(ambiguous.containerNumber).toBeNull();
    expect(ambiguous.candidates.length).toBeGreaterThan(1);

    const choice = reader.chooseCalls[0]?.[0] ?? '';
    reader.choice = choice;
    const chosen = await service.identify(await makePhoto());
    expect(chosen.verdict).toBe('corrected');
    expect(chosen.containerNumber).toBe(choice);
  });

  it('reports an unreadable photo', async () => {
    const result = await new IdentifyService(new FakeReader(null)).identify(await makePhoto());
    expect(result.verdict).toBe('unreadable');
    expect(result.candidates).toEqual([]);
  });

  it('rejects an upload that is not an image', async () => {
    const service = new IdentifyService(new FakeReader('CSQU3054383'));
    await expect(service.identify(new TextEncoder().encode('not a photo'))).rejects.toThrow(
      ValidationError,
    );
  });
});
