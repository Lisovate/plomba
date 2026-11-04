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

/** A photo of a face: a frame of a clip, or a still photo (a file in the clips folder). */
export type PhotoSpec = {
  readonly face: Face;
  /** Ask Muse Spark for damage on it, and confirm what it proposes. */
  readonly findDamage?: boolean;
} & ({ readonly frame: FrameRef } | { readonly image: string });

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
  redDoors: 'youtube-PiOBa0ewpZI-20ft-red-door-corner-static.mp4',
  mscWalk: 'pexels-37478406-20ft-msc-door-end-corner-on-truck.mp4',
  coscoDoors: 'youtube-sQ8kvCjE_04-20ft-cosco-rusty-door-end-on-trailer.mp4',
  coscoCorner: 'youtube-sQ8kvCjE_04-20ft-cosco-rusty-corner-lifted.mp4',
  hapagReefer: 'pexels-40485325-40ft-hapag-reefer-corner-yard.mp4',
  greyHighCube: 'youtube-EW03QH1GrLc-40ft-hc-grey-side-tilt-trailer.mp4',
  hamburgSudYard: 'youtube-4pxwj5LCBkc-20ft-hamburg-sud-on-truck-corner.mp4',
  oneSide: 'pexels-6193732-40ft-one-side-on-truck.mp4',
} as const;

/** The openly licensed still photos, also in the clips folder. */
export const IMAGES = {
  cronos: 'commons-shimizu-40ft-hc-cronos-dented-side.jpg',
  blueSky: 'commons-bsiu9865960-40ft-on-rail-wagon.jpg',
  texReefer: 'commons-tghu9939569-40ft-reefer-on-chassis-corner.jpg',
  cladTank: 'commons-ok-0101-20ft-tank-container-x-frame-on-chassis.jpg',
  crushed: 'commons-bremerhaven-2011-damaged-container.jpg',
} as const;

export const CREDITS: readonly string[] = [
  '"How to buy a shipping container in 10 minutes", Cowboy Steve Builds (YouTube), CC BY 3.0',
  '"40\' reefer shipping container delivery and repositioning" and "Unloading / dropping a 40\' ISO shipping container", Life, Take 2 (YouTube), CC BY 3.0',
  '"My Container One – Shipping Container Delivery Disaster", Lupo\'s Carvings & Crafts (YouTube), CC BY 3.0',
  '"Container reach stacker, Port of Rauma", Work With Sounds / Teemu Ahola, Leena Ahonen (Wikimedia Commons), CC BY 3.0',
  '"CSA - Container Depot (Iquique, Chile)", Claudio Silva Aravena (YouTube), CC BY 3.0',
  '"Kenworth T800 pulling 20 foot Container", Marlon Thomas Jr (YouTube), CC BY 3.0',
  '"Lift and Level a Container with Bottle Jack", Random Stuff You Might Need To Know (YouTube), CC BY 3.0',
  '"Overloaded Container Almost FLIPS my Rotator!", Pepe\'s Towing Service (YouTube), CC BY 3.0',
  '"Can We Haul A 40 Foot Shipping Container Up The Mountains To Our Off Grid Cabin?", Tommy Dial (YouTube), CC BY 3.0',
  '"Container reach stackers", Sounds of Changes (YouTube), CC BY 3.0',
  '"Yellow Shipping Container on a Truck in Transit", Prince Enos (Pexels), Pexels licence',
  '"Cargo Containers at a Shipping Terminal", Wolfgang Weiser (Pexels), Pexels licence',
  '"Cargo Container Trucks Queuing On The Street", Swapnil Shiwalay (Pexels), Pexels licence',
  '"Container = 静岡／清水港新興津埠頭---① 【 Pictures taken in Japan 】", "Container 【 45R1 】 TGHU 993956(9)---No,1 【 Pictures taken in Japan 】" and "Container ＝【 20ft 】 （Unknown owner） OK-0101 【 Marine container only for Japan Domestic 】", Gazouya-japan (Wikimedia Commons), CC BY-SA 4.0',
  '"21 80 4427 645-7 + Container BLUE SKY INTERMODAL BSIU 986596 0, 1, Bad Wilhelmshöhe, Kassel", GeorgDerReisende (Wikimedia Commons), CC BY-SA 4.0',
  '"Damaged container - Port of Bremerhaven - 2011", Buonasera (Wikimedia Commons), CC BY-SA 3.0',
];

const GDYNIA = 'Gdynia container terminal';
const GDANSK = 'Gdańsk deepwater terminal';
const LODZ = 'Łódź inland terminal';
const POZNAN = 'Poznań rail terminal';
const SLAWKOW = 'Sławków rail terminal';
const DEPOT = 'Pruszków container depot';
const WARSAW = 'Warsaw Praga rail terminal';
const GLIWICE = 'Gliwice inland terminal';

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
        photos: [{ face: 'R', frame: { clip: CLIPS.rusty, at: 1.8 }, findDamage: true }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.rusty, at: 6.3 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.rusty, at: 11 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.reefer, at: 1.2 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.reefer, at: 4.2 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.reefer, at: 7.5 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.reefer, at: 10.5 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.hamburgSud, at: 1.8 } }],
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
        photos: [{ face: 'R', frame: { clip: CLIPS.hamburgSud, at: 6.3 } }],
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
  {
    // An older box off lease: to the depot by truck, and sold on from there.
    number: 'RWTU3779440',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-10-13T09:40:00+02:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'K. Wójcik',
        transportMode: 'road',
        vehicleId: 'GA 61842',
        handedOverBy: GDYNIA,
        receivedBy: 'Pomorze Trans',
        photos: [{ face: 'D', frame: { clip: CLIPS.redDoors, at: 5 } }],
        video: CLIPS.redDoors,
      },
      {
        at: '2026-10-13T15:25:00+02:00',
        place: DEPOT,
        direction: 'in',
        checker: 'R. Mazur',
        transportMode: 'road',
        vehicleId: 'GA 61842',
        handedOverBy: 'Pomorze Trans',
        receivedBy: DEPOT,
        photos: [{ face: 'D', frame: { clip: CLIPS.redDoors, at: 15 } }],
      },
      {
        at: '2026-10-29T11:50:00+01:00',
        place: DEPOT,
        direction: 'out',
        checker: 'Z. Grabowski',
        transportMode: 'road',
        vehicleId: 'WPR 7H215',
        handedOverBy: DEPOT,
        receivedBy: 'Narew Haulage',
        photos: [{ face: 'D', frame: { clip: CLIPS.redDoors, at: 25 } }],
      },
    ],
  },
  {
    // The door-end corner post is scraped on the road leg from Gdańsk to Łódź, where the lashing rubbed.
    number: 'MSNU3027330',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-10-26T09:20:00+01:00',
        place: GDANSK,
        direction: 'out',
        checker: 'B. Szymańska',
        transportMode: 'road',
        vehicleId: 'GD 8L415',
        handedOverBy: GDANSK,
        receivedBy: 'Kujawy Transport',
        sealNumbers: ['ML 2290536'],
        photos: [
          { face: 'D', frame: { clip: CLIPS.mscWalk, at: 1 } },
          { face: 'R', frame: { clip: CLIPS.mscWalk, at: 12 } },
        ],
      },
      {
        at: '2026-10-27T08:35:00+01:00',
        place: LODZ,
        direction: 'in',
        checker: 'J. Kowalski',
        transportMode: 'road',
        vehicleId: 'GD 8L415',
        handedOverBy: 'Kujawy Transport',
        receivedBy: LODZ,
        sealNumbers: ['ML 2290536'],
        photos: [
          { face: 'D', frame: { clip: CLIPS.mscWalk, at: 2.6 } },
          { face: 'R', frame: { clip: CLIPS.mscWalk, at: 7 } },
        ],
        marks: [
          {
            face: 'R',
            rect: { u0: 0, v0: 0.35, u1: 0.25, v1: 1.9 },
            damageCode: 'GD',
            componentCode: 'CPS',
            note: 'Fresh scrapes and gouges down the door-end corner post, paint off to bare metal',
          },
        ],
      },
      {
        at: '2026-11-02T14:05:00+01:00',
        place: LODZ,
        direction: 'out',
        checker: 'E. Lewandowska',
        transportMode: 'rail',
        vehicleId: '31 51 4955 031-3',
        handedOverBy: LODZ,
        receivedBy: RAIL,
        sealNumbers: ['ML 2290536'],
        photos: [{ face: 'R', frame: { clip: CLIPS.mscWalk, at: 7.5 } }],
      },
    ],
  },
  {
    // Rust on the door header and corner post when it leaves Gdynia; Gliwice confirms the same damage.
    number: 'CBHU5965435',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-10-15T13:10:00+02:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'K. Wójcik',
        transportMode: 'road',
        vehicleId: 'GA 30517',
        handedOverBy: GDYNIA,
        receivedBy: 'Silesia Freight',
        sealNumbers: ['CS 1180452'],
        photos: [{ face: 'D', frame: { clip: CLIPS.coscoDoors, at: 5 }, findDamage: true }],
        marks: [
          {
            face: 'D',
            rect: { u0: 0, v0: 2.35, u1: 2.438, v1: 2.591 },
            damageCode: 'CO',
            componentCode: 'HEP',
            note: 'Rust along the door header',
          },
          {
            face: 'D',
            rect: { u0: 0, v0: 0.1, u1: 0.2, v1: 2.5 },
            damageCode: 'CO',
            componentCode: 'CPS',
            note: 'Rust streaks down the left door-end corner post',
          },
        ],
        video: CLIPS.coscoCorner,
      },
      {
        at: '2026-10-16T09:45:00+02:00',
        place: GLIWICE,
        direction: 'in',
        checker: 'H. Krawczyk',
        transportMode: 'road',
        vehicleId: 'GA 30517',
        handedOverBy: 'Silesia Freight',
        receivedBy: GLIWICE,
        sealNumbers: ['CS 1180452'],
        photos: [{ face: 'D', frame: { clip: CLIPS.coscoCorner, at: 10 } }],
      },
      {
        at: '2026-10-22T15:40:00+02:00',
        place: GLIWICE,
        direction: 'out',
        checker: 'H. Krawczyk',
        transportMode: 'road',
        vehicleId: 'SGL 4E903',
        handedOverBy: GLIWICE,
        receivedBy: 'Silesia Freight',
        photos: [{ face: 'D', frame: { clip: CLIPS.coscoDoors, at: 14 } }],
      },
    ],
  },
  {
    // A reefer off the feeder at Gdańsk, by rail to Warsaw and on by truck.
    number: 'PLBU4000254',
    sizeTypeCode: '45R1',
    handovers: [
      {
        at: '2026-10-21T14:30:00+02:00',
        place: GDANSK,
        direction: 'in',
        checker: 'M. Kamińska',
        handedOverBy: 'North Sea Feeder Lines',
        receivedBy: GDANSK,
        photos: [{ face: 'R', frame: { clip: CLIPS.hapagReefer, at: 5 } }],
      },
      {
        at: '2026-10-23T06:20:00+02:00',
        place: GDANSK,
        direction: 'out',
        checker: 'B. Szymańska',
        transportMode: 'rail',
        vehicleId: '33 51 4556 021-5',
        handedOverBy: GDANSK,
        receivedBy: RAIL,
        sealNumbers: ['HL 4417203'],
        photos: [{ face: 'R', frame: { clip: CLIPS.hapagReefer, at: 8.5 } }],
      },
      {
        at: '2026-10-24T13:45:00+02:00',
        place: WARSAW,
        direction: 'in',
        checker: 'W. Jankowski',
        transportMode: 'rail',
        vehicleId: '33 51 4556 021-5',
        handedOverBy: RAIL,
        receivedBy: WARSAW,
        sealNumbers: ['HL 4417203'],
        photos: [{ face: 'R', frame: { clip: CLIPS.hapagReefer, at: 2 } }],
      },
      {
        at: '2026-10-26T08:10:00+01:00',
        place: WARSAW,
        direction: 'out',
        checker: 'W. Jankowski',
        transportMode: 'road',
        vehicleId: 'WI 27731',
        handedOverBy: WARSAW,
        receivedBy: 'Mazury Reefer Transport',
        sealNumbers: ['HL 4417203'],
        photos: [{ face: 'R', frame: { clip: CLIPS.hapagReefer, at: 9.6 } }],
      },
    ],
  },
  {
    // An empty high cube back at the depot off a tilt trailer; its gate-out is under way.
    number: 'PLBU4000249',
    sizeTypeCode: '45G1',
    handovers: [
      {
        at: '2026-10-22T09:10:00+02:00',
        place: DEPOT,
        direction: 'in',
        checker: 'R. Mazur',
        transportMode: 'road',
        vehicleId: 'WPR 5H204',
        handedOverBy: 'Pilica Haulage',
        receivedBy: DEPOT,
        photos: [{ face: 'R', frame: { clip: CLIPS.greyHighCube, at: 20 } }],
        video: CLIPS.greyHighCube,
      },
      {
        at: '2026-11-04T08:20:00+01:00',
        place: DEPOT,
        direction: 'out',
        checker: 'Z. Grabowski',
        transportMode: 'road',
        vehicleId: 'WX 41729',
        handedOverBy: DEPOT,
        receivedBy: 'Wkra Logistics',
        photos: [{ face: 'R', frame: { clip: CLIPS.greyHighCube, at: 27.5 } }],
        open: true,
      },
    ],
  },
  {
    number: 'SUDU1765333',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-10-30T10:15:00+01:00',
        place: LODZ,
        direction: 'in',
        checker: 'J. Kowalski',
        transportMode: 'road',
        vehicleId: 'EL 2T908',
        handedOverBy: 'Łódź Express',
        receivedBy: LODZ,
        photos: [{ face: 'R', frame: { clip: CLIPS.hamburgSudYard, at: 3 } }],
        video: CLIPS.hamburgSudYard,
      },
      {
        at: '2026-11-03T07:40:00+01:00',
        place: LODZ,
        direction: 'out',
        checker: 'E. Lewandowska',
        transportMode: 'rail',
        vehicleId: '31 51 4955 032-1',
        handedOverBy: LODZ,
        receivedBy: RAIL,
        sealNumbers: ['HS 5528104'],
        photos: [{ face: 'R', frame: { clip: CLIPS.hamburgSudYard, at: 25 } }],
      },
    ],
  },
  {
    // A side panel is creased on the road leg from Poznań to Łódź.
    number: 'FDCU0436400',
    sizeTypeCode: '45G1',
    handovers: [
      {
        at: '2026-10-28T12:40:00+01:00',
        place: POZNAN,
        direction: 'out',
        checker: 'D. Piotrowska',
        transportMode: 'road',
        vehicleId: 'PO 5W662',
        handedOverBy: POZNAN,
        receivedBy: 'Wielkopolska Cargo',
        sealNumbers: ['ON 0937716'],
        photos: [{ face: 'R', frame: { clip: CLIPS.oneSide, at: 11.3 } }],
        video: CLIPS.oneSide,
      },
      {
        at: '2026-10-29T09:05:00+01:00',
        place: LODZ,
        direction: 'in',
        checker: 'J. Kowalski',
        transportMode: 'road',
        vehicleId: 'PO 5W662',
        handedOverBy: 'Wielkopolska Cargo',
        receivedBy: LODZ,
        sealNumbers: ['ON 0937716'],
        photos: [{ face: 'R', frame: { clip: CLIPS.oneSide, at: 1.5 } }],
        marks: [
          {
            face: 'R',
            rect: { u0: 2.95, v0: 0.75, u1: 3.25, v1: 1.45 },
            damageCode: 'DT',
            componentCode: 'PAA',
            note: 'Fresh crease in a side panel, about 60 cm, paint scraped',
          },
        ],
      },
    ],
  },
  {
    // Struck by a spreader before it reached Gdańsk: dents in the upper side panels and top rail.
    number: 'CRSU9239570',
    sizeTypeCode: '45G1',
    handovers: [
      {
        at: '2026-10-18T16:50:00+02:00',
        place: GDANSK,
        direction: 'in',
        checker: 'M. Kamińska',
        handedOverBy: 'Baltic Container Lines',
        receivedBy: GDANSK,
        photos: [{ face: 'R', image: IMAGES.cronos, findDamage: true }],
      },
      {
        at: '2026-10-20T10:30:00+02:00',
        place: GDANSK,
        direction: 'out',
        checker: 'B. Szymańska',
        transportMode: 'road',
        vehicleId: 'GD 9R330',
        handedOverBy: GDANSK,
        receivedBy: 'Trans-Pol Logistics',
        photos: [{ face: 'R', image: IMAGES.cronos }],
      },
    ],
  },
  {
    number: 'BSIU9865960',
    sizeTypeCode: '45G1',
    handovers: [
      {
        at: '2026-10-31T19:20:00+01:00',
        place: GDANSK,
        direction: 'out',
        checker: 'B. Szymańska',
        transportMode: 'rail',
        vehicleId: '31 51 4955 040-4',
        handedOverBy: GDANSK,
        receivedBy: RAIL,
        sealNumbers: ['PL 0431208'],
        photos: [{ face: 'R', image: IMAGES.blueSky }],
      },
      {
        at: '2026-11-02T04:55:00+01:00',
        place: SLAWKOW,
        direction: 'in',
        checker: 'T. Dąbrowski',
        transportMode: 'rail',
        vehicleId: '31 51 4955 040-4',
        handedOverBy: RAIL,
        receivedBy: SLAWKOW,
        sealNumbers: ['PL 0431208'],
        photos: [{ face: 'R', image: IMAGES.blueSky }],
      },
    ],
  },
  {
    number: 'TGHU9939569',
    sizeTypeCode: '45R1',
    handovers: [
      {
        at: '2026-10-16T08:25:00+02:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'A. Nowak',
        transportMode: 'road',
        vehicleId: 'GD 4M622',
        handedOverBy: GDYNIA,
        receivedBy: 'Mazury Reefer Transport',
        photos: [{ face: 'L', image: IMAGES.texReefer }],
      },
      {
        at: '2026-10-16T17:55:00+02:00',
        place: POZNAN,
        direction: 'in',
        checker: 'P. Zieliński',
        transportMode: 'road',
        vehicleId: 'GD 4M622',
        handedOverBy: 'Mazury Reefer Transport',
        receivedBy: POZNAN,
        photos: [{ face: 'L', image: IMAGES.texReefer }],
      },
    ],
  },
  {
    // A clad tank container in an X-braced frame, on a chassis.
    number: 'PLBU4000260',
    sizeTypeCode: '22T6',
    handovers: [
      {
        at: '2026-10-25T11:30:00+01:00',
        place: GDYNIA,
        direction: 'in',
        checker: 'A. Nowak',
        handedOverBy: 'North Sea Feeder Lines',
        receivedBy: GDYNIA,
        photos: [{ face: 'L', image: IMAGES.cladTank }],
      },
      {
        at: '2026-10-27T13:15:00+01:00',
        place: GDYNIA,
        direction: 'out',
        checker: 'K. Wójcik',
        transportMode: 'road',
        vehicleId: 'GA 77304',
        handedOverBy: GDYNIA,
        receivedBy: 'Kujawy Transport',
        sealNumbers: ['PL 0425519'],
        photos: [{ face: 'L', image: IMAGES.cladTank }],
      },
    ],
  },
  {
    // Crushed in a stack collapse at sea, discharged at Gdańsk and sent to the depot for repair.
    number: 'MEDU1284861',
    sizeTypeCode: '22G1',
    handovers: [
      {
        at: '2026-10-12T15:40:00+02:00',
        place: GDANSK,
        direction: 'in',
        checker: 'M. Kamińska',
        handedOverBy: 'Baltic Container Lines',
        receivedBy: GDANSK,
        photos: [{ face: 'D', image: IMAGES.crushed }],
        marks: [
          {
            face: 'R',
            rect: { u0: 0.4, v0: 0.3, u1: 6.058, v1: 2.591 },
            damageCode: 'BT',
            componentCode: 'PAA',
            note: 'Side wall crushed and folded in along most of its length',
          },
          {
            face: 'T',
            rect: { u0: 0.6, v0: 0, u1: 6.058, v1: 1.2 },
            damageCode: 'HO',
            componentCode: 'PAA',
            note: 'Roof torn open along the right side and folded over it',
          },
        ],
      },
      {
        at: '2026-10-14T10:20:00+02:00',
        place: GDANSK,
        direction: 'out',
        checker: 'B. Szymańska',
        transportMode: 'road',
        vehicleId: 'GD 9R330',
        handedOverBy: GDANSK,
        receivedBy: 'Trans-Pol Logistics',
        photos: [{ face: 'D', image: IMAGES.crushed }],
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
