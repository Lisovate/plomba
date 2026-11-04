/**
 * The demo installation's story: what a terminal operator's Plomba looks like
 * after three weeks of use. The containers' movements, places, people,
 * companies, trucks and wagons are invented; the footage is real and openly
 * licensed (see CREDITS). Containers whose number can't be read in the
 * footage get numbers under the made-up owner code PLBU.
 *
 * `scripts/seed-demo.ts` records it through the real services: SAM 3.1
 * registers and blurs every photo, Muse Spark proposes damage where asked,
 * and every sealed handover goes into its container's hash chain.
 */

import type { Direction, Face, TransportMode } from '@plomba/contracts';
import type { ComponentCode, DamageCode, FaceRect } from '@plomba/core';

/** A frame of an openly licensed clip: the file and the time in seconds. */
export interface FrameRef {
  readonly clip: string;
  readonly at: number;
}

export interface PhotoSpec {
  readonly face: Face;
  readonly frame: FrameRef;
  /** Ask Muse Spark for damage on it, and confirm what it proposes. */
  readonly findDamage?: boolean;
}

/** Damage the checker records by hand at this handover. */
export interface MarkSpec {
  readonly face: Face;
  readonly rect: FaceRect;
  readonly damageCode: DamageCode;
  readonly componentCode?: ComponentCode;
  readonly note?: string;
}

export interface HandoverSpec {
  /** When the checker started, with the local offset (Poland: +02:00 until 25 Oct, then +01:00). */
  readonly at: string;
  readonly place: string;
  readonly direction: Direction;
  readonly checker: string;
  readonly transportMode?: TransportMode;
  readonly vehicleId?: string;
  readonly handedOverBy?: string;
  readonly receivedBy?: string;
  readonly sealNumbers?: readonly string[];
  readonly photos?: readonly PhotoSpec[];
  readonly marks?: readonly MarkSpec[];
  /** A walk-around clip kept with the handover as evidence. */
  readonly video?: string;
  /** Left open: the checker is still at it, or the train hasn't arrived. */
  readonly open?: boolean;
}

export interface ContainerSpec {
  readonly number: string;
  readonly sizeTypeCode: string;
  readonly handovers: readonly HandoverSpec[];
}

/** The openly licensed clips the photos are taken from. */
export const CLIPS = {
  rusty: 'WFknzOt_8UA-1036-40ft-rusty-side-on-trailer.mp4',
  reefer: 'CZkrwiKmvpY-0104-40ft-reefer-corner-moving.mp4',
  seacoSide: 'n0jCMBS5wew-0029-40ft-side-on-trailer.mp4',
  seacoDoors: 'n0jCMBS5wew-0138-40ft-door-end-on-trailer.mp4',
  mscDoors: 'alN3mSyWd9Q-0244-40ft-door-end-number.mp4',
  mscCorner: 'alN3mSyWd9Q-0303-40ft-door-corner-walkaround.mp4',
  hamburgSud: 'commons-rauma-0119-20ft-on-truck-side.mp4',
  uetuDoors: 'commons-rauma-0014-door-end-on-truck.mp4',
  kLine: 'gNrturGCkrc-0015-40ft-door-end-lifted-from-chassis.mp4',
  highway: 'ZgUkY9awHmg-0003-20ft-door-end-on-truck-highway.mp4',
} as const;

export const CREDITS: readonly string[] = [
  '"How to buy a shipping container in 10 minutes", Cowboy Steve Builds (YouTube), CC BY 3.0',
  '"40\' reefer shipping container delivery and repositioning" and "Unloading / dropping a 40\' ISO shipping container", Life, Take 2 (YouTube), CC BY 3.0',
  '"My Container One – Shipping Container Delivery Disaster", Lupo\'s Carvings & Crafts (YouTube), CC BY 3.0',
  '"Container reach stacker, Port of Rauma", Work With Sounds / Teemu Ahola, Leena Ahonen (Wikimedia Commons), CC BY 3.0',
  '"CSA - Container Depot (Iquique, Chile)", Claudio Silva Aravena (YouTube), CC BY 3.0',
  '"Kenworth T800 pulling 20 foot Container", Marlon Thomas Jr (YouTube), CC BY 3.0',
];

const GDYNIA = 'Gdynia container terminal';
const GDANSK = 'Gdańsk deepwater terminal';
const LODZ = 'Łódź inland terminal';
const POZNAN = 'Poznań rail terminal';
const SLAWKOW = 'Sławków rail terminal';
const DEPOT = 'Pruszków container depot';

const RAIL = 'Vistula Rail';

export const SCENARIO: readonly ContainerSpec[] = [
  {
    // The rust recorded at Gdynia is drawn on the new photo at Łódź, where the gate-out is under way.
    number: 'PLBU4000043',
    sizeTypeCode: '42G1',
    handovers: [
      {
        at: '2026-10-27T08:10:00+01:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'A. Nowak',
        transportMode: 'rail',
        vehicleId: '31 51 4955 012-3',
        handedOverBy: GDYNIA,
        receivedBy: RAIL,
        sealNumbers: ['PL 0412377'],
        photos: [{ face: 'L', frame: { clip: CLIPS.rusty, at: 1.8 }, findDamage: true }],
        video: CLIPS.rusty,
      },
      {
        at: '2026-10-28T14:25:00+01:00',
        place: LODZ,
        direction: 'in',
        checker: 'J. Kowalski',
        transportMode: 'rail',
        vehicleId: '31 51 4955 012-3',
        handedOverBy: RAIL,
        receivedBy: LODZ,
        sealNumbers: ['PL 0412377'],
        photos: [{ face: 'L', frame: { clip: CLIPS.rusty, at: 6.3 } }],
      },
      {
        at: '2026-11-04T10:05:00+01:00',
        place: LODZ,
        direction: 'out',
        checker: 'E. Lewandowska',
        transportMode: 'road',
        vehicleId: 'EL 4K217',
        handedOverBy: LODZ,
        receivedBy: 'Mazovia Haulage',
        photos: [{ face: 'L', frame: { clip: CLIPS.rusty, at: 11 } }],
        open: true,
      },
    ],
  },
  {
    number: 'PLBU4000059',
    sizeTypeCode: '45R1',
    handovers: [
      {
        at: '2026-10-20T11:30:00+02:00',
        place: GDYNIA,
        direction: 'in',
        checker: 'K. Wójcik',
        transportMode: 'road',
        vehicleId: 'GD 3J118',
        handedOverBy: 'Pomorze Trans',
        receivedBy: GDYNIA,
        photos: [{ face: 'L', frame: { clip: CLIPS.reefer, at: 1.2 } }],
        video: CLIPS.reefer,
      },
      {
        at: '2026-10-22T07:50:00+02:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'A. Nowak',
        transportMode: 'rail',
        vehicleId: '33 51 4556 013-2',
        handedOverBy: GDYNIA,
        receivedBy: RAIL,
        sealNumbers: ['PL 0398120'],
        photos: [{ face: 'L', frame: { clip: CLIPS.reefer, at: 4.2 } }],
      },
      {
        at: '2026-10-23T16:15:00+02:00',
        place: POZNAN,
        direction: 'in',
        checker: 'P. Zieliński',
        transportMode: 'rail',
        vehicleId: '33 51 4556 013-2',
        handedOverBy: RAIL,
        receivedBy: POZNAN,
        sealNumbers: ['PL 0398120'],
        photos: [{ face: 'L', frame: { clip: CLIPS.reefer, at: 7.5 } }],
      },
      {
        at: '2026-10-24T09:40:00+02:00',
        place: POZNAN,
        direction: 'out',
        checker: 'P. Zieliński',
        transportMode: 'road',
        vehicleId: 'PO 8M341',
        handedOverBy: POZNAN,
        receivedBy: 'Wielkopolska Cargo',
        photos: [{ face: 'L', frame: { clip: CLIPS.reefer, at: 10.5 } }],
      },
    ],
  },
  {
    // A dent appears on the road leg from Gdańsk to Łódź: the claims desk's case.
    number: 'PLBU4000172',
    sizeTypeCode: '42G1',
    handovers: [
      {
        at: '2026-10-29T13:20:00+01:00',
        place: GDANSK,
        direction: 'out',
        checker: 'M. Kamińska',
        transportMode: 'road',
        vehicleId: 'GD 7K204',
        handedOverBy: GDANSK,
        receivedBy: 'Trans-Pol Logistics',
        sealNumbers: ['PL 0420551'],
        photos: [
          { face: 'L', frame: { clip: CLIPS.seacoSide, at: 7.8 } },
          { face: 'D', frame: { clip: CLIPS.seacoDoors, at: 1.8 } },
        ],
        video: CLIPS.seacoSide,
      },
      {
        at: '2026-10-30T10:45:00+01:00',
        place: LODZ,
        direction: 'in',
        checker: 'J. Kowalski',
        transportMode: 'road',
        vehicleId: 'GD 7K204',
        handedOverBy: 'Trans-Pol Logistics',
        receivedBy: LODZ,
        sealNumbers: ['PL 0420551'],
        photos: [
          { face: 'L', frame: { clip: CLIPS.seacoSide, at: 11 } },
          { face: 'D', frame: { clip: CLIPS.seacoDoors, at: 2.6 } },
        ],
        marks: [
          {
            face: 'L',
            rect: { u0: 4.1, v0: 0.12, u1: 4.75, v1: 0.55 },
            damageCode: 'DT',
            note: 'Fresh dent in the bottom side rail, about 40 cm, paint scraped',
          },
        ],
      },
      {
        at: '2026-11-03T15:30:00+01:00',
        place: LODZ,
        direction: 'out',
        checker: 'E. Lewandowska',
        transportMode: 'rail',
        vehicleId: '33 51 4556 014-0',
        handedOverBy: LODZ,
        receivedBy: RAIL,
        sealNumbers: ['PL 0420551'],
        photos: [{ face: 'L', frame: { clip: CLIPS.seacoSide, at: 9 } }],
      },
    ],
  },
  {
    // Arrives from the ship already worn: every later handover confirms the same damage.
    number: 'MSCU9749070',
    sizeTypeCode: '45G1',
    handovers: [
      {
        at: '2026-10-14T09:15:00+02:00',
        place: GDYNIA,
        direction: 'in',
        checker: 'K. Wójcik',
        handedOverBy: 'Baltic Container Lines',
        receivedBy: GDYNIA,
        photos: [{ face: 'D', frame: { clip: CLIPS.mscDoors, at: 10.8 }, findDamage: true }],
        marks: [
          {
            face: 'L',
            rect: { u0: 6.2, v0: 0.1, u1: 8.4, v1: 0.9 },
            damageCode: 'DT',
            note: 'Row of dents with bare-paint scrapes in the lower side panels',
          },
          {
            face: 'L',
            rect: { u0: 0.1, v0: 0.05, u1: 1.2, v1: 0.4 },
            damageCode: 'CO',
            note: 'Rust on the bottom rail by the door-end corner post',
          },
        ],
      },
      {
        at: '2026-10-15T18:40:00+02:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'A. Nowak',
        transportMode: 'rail',
        vehicleId: '31 51 4955 013-1',
        handedOverBy: GDYNIA,
        receivedBy: RAIL,
        sealNumbers: ['ML 2271904'],
        photos: [{ face: 'D', frame: { clip: CLIPS.mscDoors, at: 13.5 } }],
      },
      {
        at: '2026-10-17T06:55:00+02:00',
        place: SLAWKOW,
        direction: 'in',
        checker: 'T. Dąbrowski',
        transportMode: 'rail',
        vehicleId: '31 51 4955 013-1',
        handedOverBy: RAIL,
        receivedBy: SLAWKOW,
        sealNumbers: ['ML 2271904'],
        photos: [{ face: 'D', frame: { clip: CLIPS.mscCorner, at: 1.8 } }],
      },
      {
        at: '2026-10-21T12:10:00+02:00',
        place: SLAWKOW,
        direction: 'out',
        checker: 'T. Dąbrowski',
        transportMode: 'road',
        vehicleId: 'SK 4R772',
        handedOverBy: SLAWKOW,
        receivedBy: 'Silesia Freight',
        photos: [{ face: 'D', frame: { clip: CLIPS.mscDoors, at: 2 } }],
      },
    ],
  },
  {
    number: 'PLBU4000207',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-10-31T08:30:00+01:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'K. Wójcik',
        transportMode: 'road',
        vehicleId: 'GA 52713',
        handedOverBy: GDYNIA,
        receivedBy: 'Pomorze Trans',
        photos: [{ face: 'L', frame: { clip: CLIPS.hamburgSud, at: 1.8 } }],
        video: CLIPS.hamburgSud,
      },
      {
        at: '2026-10-31T15:05:00+01:00',
        place: DEPOT,
        direction: 'in',
        checker: 'R. Mazur',
        transportMode: 'road',
        vehicleId: 'GA 52713',
        handedOverBy: 'Pomorze Trans',
        receivedBy: DEPOT,
        photos: [{ face: 'L', frame: { clip: CLIPS.hamburgSud, at: 6.3 } }],
      },
    ],
  },
  {
    number: 'UETU5042741',
    sizeTypeCode: '45G1',
    handovers: [
      {
        at: '2026-10-24T10:20:00+02:00',
        place: GDANSK,
        direction: 'out',
        checker: 'M. Kamińska',
        transportMode: 'rail',
        vehicleId: '31 51 4955 021-4',
        handedOverBy: GDANSK,
        receivedBy: RAIL,
        sealNumbers: ['PL 0401887'],
        photos: [{ face: 'D', frame: { clip: CLIPS.uetuDoors, at: 4.5 } }],
      },
      {
        at: '2026-10-26T07:35:00+01:00',
        place: LODZ,
        direction: 'in',
        checker: 'J. Kowalski',
        transportMode: 'rail',
        vehicleId: '31 51 4955 021-4',
        handedOverBy: RAIL,
        receivedBy: LODZ,
        sealNumbers: ['PL 0401887'],
        photos: [{ face: 'D', frame: { clip: CLIPS.uetuDoors, at: 13.5 } }],
      },
      {
        at: '2026-11-02T11:00:00+01:00',
        place: LODZ,
        direction: 'out',
        checker: 'E. Lewandowska',
        transportMode: 'road',
        vehicleId: 'EL 9C551',
        handedOverBy: LODZ,
        receivedBy: 'Mazovia Haulage',
        photos: [{ face: 'D', frame: { clip: CLIPS.uetuDoors, at: 9 } }],
      },
    ],
  },
  {
    // The door is dented on the rail leg to Sławków.
    number: 'KKFU1823948',
    sizeTypeCode: '42G1',
    handovers: [
      {
        at: '2026-10-16T13:45:00+02:00',
        place: GDYNIA,
        direction: 'in',
        checker: 'K. Wójcik',
        transportMode: 'road',
        vehicleId: 'GD 1N903',
        handedOverBy: 'Pomorze Trans',
        receivedBy: GDYNIA,
        photos: [{ face: 'D', frame: { clip: CLIPS.kLine, at: 1.1 } }],
        video: CLIPS.kLine,
      },
      {
        at: '2026-10-18T08:05:00+02:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'A. Nowak',
        transportMode: 'rail',
        vehicleId: '33 51 4556 015-7',
        handedOverBy: GDYNIA,
        receivedBy: RAIL,
        sealNumbers: ['KL 7730215'],
        photos: [{ face: 'D', frame: { clip: CLIPS.kLine, at: 2.8 } }],
      },
      {
        at: '2026-10-19T19:30:00+02:00',
        place: SLAWKOW,
        direction: 'in',
        checker: 'T. Dąbrowski',
        transportMode: 'rail',
        vehicleId: '33 51 4556 015-7',
        handedOverBy: RAIL,
        receivedBy: SLAWKOW,
        sealNumbers: ['KL 7730215'],
        photos: [{ face: 'D', frame: { clip: CLIPS.kLine, at: 1.6 } }],
        marks: [
          {
            face: 'D',
            rect: { u0: 0.4, v0: 0.5, u1: 0.95, v1: 0.95 },
            damageCode: 'DT',
            note: 'Left door panel dented beside the lower locking bar',
          },
        ],
      },
    ],
  },
  {
    number: 'PLBU4000228',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-11-02T07:15:00+01:00',
        place: LODZ,
        direction: 'out',
        checker: 'E. Lewandowska',
        transportMode: 'road',
        vehicleId: 'LD 5520C',
        handedOverBy: LODZ,
        receivedBy: 'Łódź Express',
        photos: [{ face: 'D', frame: { clip: CLIPS.highway, at: 8.4 } }],
        video: CLIPS.highway,
      },
      {
        at: '2026-11-02T12:40:00+01:00',
        place: DEPOT,
        direction: 'in',
        checker: 'R. Mazur',
        transportMode: 'road',
        vehicleId: 'LD 5520C',
        handedOverBy: 'Łódź Express',
        receivedBy: DEPOT,
        photos: [{ face: 'D', frame: { clip: CLIPS.highway, at: 12 } }],
      },
    ],
  },
  // Train TR 41021 from Gdynia, due at Łódź this afternoon: the rail operator's system
  // opened a gate-in for each container from the wagon list (examples/rail-operator-train-arrival).
  ...[
    ['PLBU4000070', '45G1', '33 51 4556 012-4', 'PL 0412380'],
    ['PLBU4000085', '22G1', '33 51 4556 012-4', 'PL 0412381'],
    ['PLBU4000090', '42G1', '33 51 4556 013-2', 'PL 0412382'],
    ['PLBU4000104', '22G1', '33 51 4556 013-2', null],
    ['PLBU4000110', '45G1', '33 51 4556 014-0', 'PL 0412384'],
    ['PLBU4000125', '22G1', '33 51 4556 015-7', 'PL 0412385'],
    ['PLBU4000130', '22G1', '33 51 4556 015-7', 'PL 0412386'],
    ['PLBU4000146', '22G1', '33 51 4556 015-7', 'PL 0412387'],
  ].map(
    ([number, sizeTypeCode, wagon, seal], i): ContainerSpec => ({
      number: number as string,
      sizeTypeCode: sizeTypeCode as string,
      handovers: [
        {
          at: `2026-11-04T06:${String(10 + i).padStart(2, '0')}:00+01:00`,
          place: LODZ,
          direction: 'in',
          checker: 'J. Kowalski',
          transportMode: 'rail',
          vehicleId: wagon as string,
          handedOverBy: RAIL,
          receivedBy: LODZ,
          sealNumbers: seal ? [seal] : [],
          open: true,
        },
      ],
    }),
  ),
];
