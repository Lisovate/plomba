import { describe, expect, it } from 'vitest';
import { buildCodeco, type CodecoInput, escapeEdifact, toEdifactText } from '../src/codeco.ts';

const gateIn: CodecoInput = {
  senderId: 'PLOMBA',
  recipientId: 'MSCU',
  interchangeRef: '00000000000001',
  documentNumber: 'HO-2026-0001',
  preparedAt: new Date('2026-10-28T09:15:00Z'),
  direction: 'in',
  containerNumber: 'MEDU1284861',
  sizeTypeCode: '22G1',
  fullEmpty: 'empty',
  movedAt: new Date('2026-10-28T09:02:00Z'),
  place: { unLocode: 'PLGDY', name: 'Gdynia rail terminal' },
  sealNumbers: ['ML123456'],
  inlandTransport: { mode: 'rail', reference: 'TRAIN 4711' },
  damages: [{ locationCode: 'RXXX', damageCode: 'BT', componentCode: 'PAA' }],
  recordHash: '343d5d2963af1020c1fa7b96c569976054fdc650d0b19df1a50079909c98f2fe',
};

const segments = (interchange: string) => interchange.split('\n');

describe('buildCodeco', () => {
  it('builds a gate-in report in the SMDG D.95B layout', () => {
    expect(segments(buildCodeco(gateIn))).toEqual([
      "UNA:+.? '",
      "UNB+UNOC:3+PLOMBA+MSCU+261028:0915+00000000000001'",
      "UNH+00000000000001+CODECO:D:95B:UN:SMDG16'",
      "BGM+34+HO-2026-0001+9'",
      "NAD+MS+PLOMBA'",
      "EQD+CN+MEDU1284861+22G1:102:5+++4'",
      "RFF+SQ:1'",
      "DTM+7:202610280902:203'",
      "LOC+165+PLGDY:139:6:GDYNIA RAIL TERMINAL'",
      "SEL+ML123456'",
      "FTX+AAI+++PLOMBA RECORD SHA-256:343d5d2963af1020c1fa7b96c569976054fdc650d0b19df1a50079909c98f2fe'".toUpperCase(),
      "DAM+1+BT+RXXX'",
      "COD+PAA'",
      "TDT+1+TRAIN 4711+2'",
      "CNT+16:1'",
      "UNT+14+00000000000001'",
      "UNZ+1+00000000000001'",
    ]);
  });

  it('counts every segment from UNH to UNT in UNT', () => {
    const lines = segments(buildCodeco({ ...gateIn, damages: [], sealNumbers: [] }));
    const unh = lines.findIndex((l) => l.startsWith('UNH'));
    const unt = lines.findIndex((l) => l.startsWith('UNT'));
    expect(lines[unt]).toBe(`UNT+${unt - unh + 1}+00000000000001'`);
  });

  it('reports gate-out with BGM 36 and leaves out what is unknown', () => {
    const lines = segments(
      buildCodeco({
        ...gateIn,
        direction: 'out',
        sizeTypeCode: null,
        place: { name: 'Łódź Olechów' },
        damages: [],
        sealNumbers: [],
        inlandTransport: undefined,
        recordHash: undefined,
        fullEmpty: undefined,
      }),
    );
    expect(lines).toContain("BGM+36+HO-2026-0001+9'");
    expect(lines).toContain("EQD+CN+MEDU1284861'");
    expect(lines).toContain("LOC+165+:::LODZ OLECHOW'");
    expect(
      lines.some((l) => l.startsWith('TDT') || l.startsWith('DAM') || l.startsWith('SEL')),
    ).toBe(false);
  });

  it('lists at most 9 damages and says how many there were', () => {
    const damages = Array.from({ length: 11 }, () => ({ locationCode: 'LB1N', damageCode: 'DT' }));
    const lines = segments(buildCodeco({ ...gateIn, damages }));
    expect(lines.filter((l) => l.startsWith('DAM+'))).toHaveLength(9);
    expect(lines).toContain("FTX+DAR+++11 DAMAGES, FIRST 9 LISTED'");
  });
});

describe('EDIFACT text', () => {
  it('escapes service characters with the release character', () => {
    expect(escapeEdifact("A+B:C'D?E")).toBe("A?+B?:C?'D??E");
  });

  it('transliterates to upper-case ASCII', () => {
    expect(toEdifactText('Łódź Olechów, Gdańsk')).toBe('LODZ OLECHOW, GDANSK');
  });
});
