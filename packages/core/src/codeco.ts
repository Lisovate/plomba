/**
 * EDIFACT CODECO (container gate-in / gate-out report), directory D.95B, as
 * profiled by the SMDG implementation guide version 1.6 (2016):
 * https://smdg.org/documents/edifact-migs-message-implementation-guidelines/container-messages/
 *
 * One interchange with one message reporting one container. Free text is
 * transliterated to upper-case ASCII so the message is valid in the UNOC
 * character set and readable by older systems.
 */

/** ISO 9897 damage detail for group 6. SMDG allows up to 9 per container. */
export interface CodecoDamage {
  readonly locationCode: string;
  readonly damageCode: string;
  readonly componentCode?: string | null;
}

export interface CodecoInput {
  /** Interchange sender and recipient IDs, as agreed with the trading partner. */
  readonly senderId: string;
  readonly recipientId: string;
  /** Unique per interchange and message; at most 14 characters. */
  readonly interchangeRef: string;
  readonly documentNumber: string;
  readonly preparedAt: Date;
  readonly direction: 'in' | 'out';
  readonly containerNumber: string;
  readonly sizeTypeCode: string | null;
  readonly fullEmpty?: 'full' | 'empty';
  /** When the container passed the gate. */
  readonly movedAt: Date;
  /** Where: a UN/LOCODE if known, and a name. */
  readonly place: { readonly unLocode?: string; readonly name: string };
  readonly sealNumbers: readonly string[];
  /** The road or rail leg that brought or collected the container. */
  readonly inlandTransport?: {
    readonly mode: 'road' | 'rail';
    readonly reference?: string;
  };
  readonly damages: readonly CodecoDamage[];
  /** SHA-256 of the sealed handover record this message reports. */
  readonly recordHash?: string;
}

/** Group 6 (EQD/DAM) repeats at most 9 times in the SMDG profile. */
export const MAX_CODECO_DAMAGES = 9;

const MODE_OF_TRANSPORT = { rail: '2', road: '3' } as const;

/** Escapes the EDIFACT service characters with the release character `?`. */
export function escapeEdifact(value: string): string {
  return value.replace(/[?+:']/g, (c) => `?${c}`);
}

/** Upper-case ASCII: Łódź becomes LODZ. */
export function toEdifactText(value: string): string {
  return value
    .replace(/[łŁ]/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .toUpperCase()
    .trim();
}

const text = (value: string, max: number) => escapeEdifact(toEdifactText(value).slice(0, max));

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** CCYYMMDDHHMM in UTC (format 203). */
function dateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/**
 * Builds the interchange. Segments end with `'` and a line break, which
 * EDIFACT receivers ignore and people can read.
 */
export function buildCodeco(input: CodecoInput): string {
  const ref = input.interchangeRef.slice(0, 14);
  const prepared = dateTime(input.preparedAt);
  const message: string[] = [];
  const add = (segment: string) => message.push(`${segment}'`);

  add(`UNH+${escapeEdifact(ref)}+CODECO:D:95B:UN:SMDG16`);
  add(`BGM+${input.direction === 'in' ? '34' : '36'}+${text(input.documentNumber, 35)}+9`);
  add(`NAD+MS+${text(input.senderId, 35)}`);

  const sizeType = input.sizeTypeCode ? `${text(input.sizeTypeCode, 10)}:102:5` : '';
  const fullEmpty = input.fullEmpty ? (input.fullEmpty === 'full' ? '5' : '4') : '';
  add(`EQD+CN+${text(input.containerNumber, 17)}+${sizeType}+++${fullEmpty}`.replace(/\++$/, ''));
  add('RFF+SQ:1');
  add(`DTM+7:${dateTime(input.movedAt)}:203`);
  const unLocode = input.place.unLocode ? `${text(input.place.unLocode, 25)}:139:6` : ':::';
  const placeName = text(input.place.name, 70);
  add(
    input.place.unLocode ? `LOC+165+${unLocode}:${placeName}` : `LOC+165+${unLocode}${placeName}`,
  );
  for (const seal of input.sealNumbers) add(`SEL+${text(seal, 10)}`);
  if (input.recordHash) add(`FTX+AAI+++PLOMBA RECORD SHA-256:${text(input.recordHash, 70)}`);
  if (input.damages.length > MAX_CODECO_DAMAGES) {
    add(`FTX+DAR+++${input.damages.length} DAMAGES, FIRST ${MAX_CODECO_DAMAGES} LISTED`);
  }
  for (const damage of input.damages.slice(0, MAX_CODECO_DAMAGES)) {
    add(`DAM+1+${text(damage.damageCode, 3)}+${text(damage.locationCode, 4)}`);
    if (damage.componentCode) add(`COD+${text(damage.componentCode, 3)}`);
  }
  if (input.inlandTransport) {
    const reference = input.inlandTransport.reference
      ? text(input.inlandTransport.reference, 17)
      : '';
    add(`TDT+1+${reference}+${MODE_OF_TRANSPORT[input.inlandTransport.mode]}`);
  }
  add('CNT+16:1');
  add(`UNT+${message.length + 1}+${escapeEdifact(ref)}`);

  return [
    "UNA:+.? '",
    `UNB+UNOC:3+${text(input.senderId, 35)}+${text(input.recipientId, 35)}+${prepared.slice(2, 8)}:${prepared.slice(8)}+${escapeEdifact(ref)}'`,
    ...message,
    `UNZ+1+${escapeEdifact(ref)}'`,
  ].join('\n');
}
