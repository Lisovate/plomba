/**
 * One entry per kind of company a container passes through. Each becomes a
 * page under /solutions/, a card on the home page and a footer link.
 */

import type { IconName } from './icons.ts';
import type { Image } from './images.ts';
import { IMAGES } from './images.ts';

export interface Point {
  readonly title: string;
  /** Plain text; `backticks` mark code. */
  readonly body: string;
}

export interface Gain extends Point {
  readonly icon: IconName;
}

export interface Solution {
  readonly slug: string;
  /** Who it's for, as a heading: "Shipping lines and shipowners". */
  readonly audience: string;
  /** For links and the footer: "Shipping lines". */
  readonly shortName: string;
  readonly icon: IconName;
  /** One sentence for cards. */
  readonly summary: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly title: string;
  readonly lead: string;
  readonly pains: readonly Point[];
  readonly gains: readonly Gain[];
  readonly screen: Image;
  readonly screenCaption: string;
  readonly integration: {
    readonly intro: string;
    readonly steps: readonly string[];
    /** A runnable example in the repository's examples/ folder. */
    readonly example?: { readonly folder: string; readonly description: string };
  };
}

export const SOLUTIONS: readonly Solution[] = [
  {
    slug: 'shipping-lines',
    audience: 'Shipping lines and shipowners',
    shortName: 'Shipping lines',
    icon: 'ship',
    summary:
      'Damage claims backed by a sealed record from every handover, and CODECO gate messages that point to the evidence.',
    metaTitle: 'Plomba for shipping lines and shipowners: claims with evidence',
    metaDescription:
      'Claims backed by a sealed record from every handover, CODECO gate messages with ISO 9897 damage codes, and container condition across your network.',
    title: 'Damage claims backed by a record from every handover',
    lead: "Your containers pass through terminals, railways, hauliers and depots you don't run. Plomba gives each of them the same inspection, coded to the standards your systems read and sealed so it holds up in a claim.",
    pains: [
      {
        title: 'Claims without evidence',
        body: 'When a box comes back damaged, the claims desk has to show which leg it happened on. Paper receipts and loose photos rarely say.',
      },
      {
        title: "Reports that can't be compared",
        body: 'Each terminal and depot reports condition its own way: free text, faces missing, photos without a date or a place.',
      },
      {
        title: 'Gate messages without the evidence',
        body: 'A CODECO tells you a container passed the gate. It rarely tells you what the container looked like, or where the photos are.',
      },
    ],
    gains: [
      {
        icon: 'scale',
        title: 'A claim, drafted and checked',
        body: 'For new damage, a Muse Spark agent drafts a claim against the party that had custody. Every item and hash it cites is checked against the sealed records before the draft is shown.',
      },
      {
        icon: 'book-open-check',
        title: 'Where it happened',
        body: 'The damage passport places each damage between the last handover that photographed the spot clean and the first that recorded it, so a dispute narrows to the legs in between.',
      },
      {
        icon: 'file-code',
        title: 'CODECO that points to the record',
        body: "Gate-in and gate-out messages in EDIFACT CODECO D.95B, with ISO 9897 damage codes and the sealed record's SHA-256.",
      },
      {
        icon: 'globe',
        title: 'Condition across the network',
        body: 'The record follows the container number, not the site, so the next handover anywhere starts from the last one.',
      },
    ],
    screen: IMAGES.passport,
    screenCaption:
      'The damage passport: every damage, coloured by the handover that first recorded it.',
    integration: {
      intro: 'Plomba sends what your claims and equipment systems need as each handover is sealed.',
      steps: [
        'Receive the `handover.sealed` webhook: it carries the marks and, for each damage, the last handover that photographed the spot clean.',
        'Take CODECO gate messages into your EDI flow next to the ones you already receive.',
        'For a handover with new damage, ask for a claim draft over the same API.',
      ],
      example: {
        folder: 'examples/shipping-line-claims-desk',
        description:
          'A claims desk that checks each signed delivery and opens a claim for damage that appeared on a leg, addressed to whoever had the container.',
      },
    },
  },
  {
    slug: 'rail-and-intermodal',
    audience: 'Intermodal and rail operators',
    shortName: 'Rail and intermodal',
    icon: 'train-front',
    summary:
      'Condition at both ends of the rail leg, with the wagon each container rode on, checked fast when a train arrives.',
    metaTitle: 'Plomba for intermodal and rail operators: proof for the rail leg',
    metaDescription:
      "Record each container's condition when it's loaded onto and taken off the train, with checked UIC wagon numbers, so the rail leg's liability rests on evidence.",
    title: 'Proof of condition for every container on the train',
    lead: 'A rail leg starts with one handover and ends with another. Plomba records the condition at both, with the wagon the container rode on, so liability for the rail leg rests on evidence rather than argument.',
    pains: [
      {
        title: 'A whole train at once',
        body: 'A train brings dozens of containers to the terminal together, and checkers have little time for each box.',
      },
      {
        title: 'Wagon numbers on paper',
        body: 'Which wagon carried which container is written down by hand, if at all, and a mistyped number goes unnoticed.',
      },
      {
        title: 'The rail leg gets the blame',
        body: 'Without photos from both ends, damage found after the train is hard to place before, during or after the rail leg.',
      },
    ],
    gains: [
      {
        icon: 'video',
        title: 'One walk-around per container',
        body: 'A single video around the container instead of five photos. The number is read from the doors and verified by its ISO 6346 check digit.',
      },
      {
        icon: 'hash',
        title: 'Wagon numbers checked as typed',
        body: 'UIC wagon numbers carry a self-check digit. Plomba checks it as the checker types and stores the wagon with the handover.',
      },
      {
        icon: 'book-open-check',
        title: 'Both ends of the rail leg',
        body: 'Loading and unloading are sealed handovers. The damage passport shows whether damage appeared between them.',
      },
      {
        icon: 'mic',
        title: 'Hands-free damage notes',
        body: 'The checker says what they see, in Polish or English, and gets a coded proposal on the section named.',
      },
    ],
    screen: IMAGES.walkaround,
    screenCaption: 'A walk-around video: SAM 3.1 tracks the container in every frame.',
    integration: {
      intro: 'Each container on the train becomes a sealed handover your systems can pick up.',
      steps: [
        'Send the wagon list before the train arrives: every container and wagon number is checked digit by digit, and a gate-in handover opens for each container with its wagon and seals.',
        'Send CODECO gate messages with the rail transport leg to the shipping line or operator.',
        'Receive a `handover.sealed` webhook as each container is checked, with its wagon number.',
      ],
      example: {
        folder: 'examples/rail-operator-train-arrival',
        description: "Turns a train's wagon list into gate-in handovers before the train arrives.",
      },
    },
  },
  {
    slug: 'trucking',
    audience: 'Trucking companies',
    shortName: 'Trucking',
    icon: 'truck',
    summary:
      'A receipt the driver can show at the next gate, with the photos and the damage recorded at pickup.',
    metaTitle: "Plomba for trucking companies: the driver's receipt",
    metaDescription:
      "Give drivers an EIR with the photos and damage recorded at pickup, so a dispute at the delivery gate is settled from the record, not the driver's word.",
    title: 'A receipt the driver can show at the next gate',
    lead: 'When a driver collects a container, the condition recorded at the gate decides who pays for damage found later. Plomba gives the haulier the same record the terminal keeps.',
    pains: [
      {
        title: 'Disputes at the gate',
        body: 'Damage is noticed at delivery and the haulier is asked to pay, with nothing to show what the box looked like at pickup.',
      },
      {
        title: 'A carbon copy, if anything',
        body: "The driver leaves with a paper copy or nothing at all, and the photos stay in the terminal's system.",
      },
      {
        title: 'Time at the gate',
        body: 'Slow inspections hold trucks up. Skipped inspections leave the haulier exposed.',
      },
    ],
    gains: [
      {
        icon: 'receipt-text',
        title: 'The EIR as a PDF',
        body: "Every sealed handover produces an equipment interchange receipt with the photos, each damage and the record's hash, to print or save.",
      },
      {
        icon: 'crosshair',
        title: 'Pickup and delivery compared',
        body: "The next handover sees the last one's damage on the same spot, so only damage that is really new counts as new.",
      },
      {
        icon: 'shield-check',
        title: "A record that can't be quietly changed",
        body: 'Each handover is hash-chained to the one before. Editing a sealed record breaks the chain, and Plomba shows where.',
      },
      {
        icon: 'truck',
        title: 'The truck on the record',
        body: "The handover stores the truck's registration with the place, the time and the checker.",
      },
    ],
    screen: IMAGES.handover,
    screenCaption: "A gate-out at Łódź: the last handover's corrosion mark drawn on a new photo.",
    integration: {
      intro: 'The receipt reaches the driver and the dispatcher without anyone retyping it.',
      steps: [
        'Subscribe to `handover.sealed` and attach the EIR PDF to the job in your transport management system.',
        "Look up a container's history over the REST API when a delivery is disputed.",
        'Send the receipt to the driver by the channel you already use.',
      ],
      example: {
        folder: 'examples/trucking-driver-receipt',
        description:
          "Finds a truck's sealed handover and prints the driver's receipt, with the record's hash checked.",
      },
    },
  },
  {
    slug: 'container-owners-and-leasing',
    audience: 'Container owners and leasing companies',
    shortName: 'Container owners and leasing',
    icon: 'container',
    summary:
      'On-hire and off-hire compared on the same spots, with standard codes and evidence for recharging lessees.',
    metaTitle: 'Plomba for container owners and leasing companies: on-hire and off-hire',
    metaDescription:
      'Compare on-hire and off-hire condition on the same spots, keep one damage history per container, and recharge lessees with evidence they can check.',
    title: 'Know the condition of every box you lease out',
    lead: 'On-hire and off-hire inspections decide what a lessee pays for. Plomba records both on the same coordinates and codes, so the off-hire walk-around starts from the on-hire damage and you can recharge with evidence.',
    pains: [
      {
        title: "On-hire and off-hire don't line up",
        body: 'Different depots, checkers and formats make comparing condition at return with condition at pickup manual work.',
      },
      {
        title: 'Recharges get disputed',
        body: "Lessees push back on damage charges they can't see the evidence for.",
      },
      {
        title: 'Fleet condition is scattered',
        body: 'Condition lives in depot reports, emails and spreadsheets, not in one place per container.',
      },
    ],
    gains: [
      {
        icon: 'crosshair',
        title: 'Off-hire starts from on-hire',
        body: 'The off-hire walk-around shows the on-hire damage on the same spot. Anything else is new, and coded to ISO 9897.',
      },
      {
        icon: 'scale',
        title: 'Evidence for recharges',
        body: 'Each new damage has its photo hash, its CEDEX location, damage and component codes, and the handovers between which it appeared.',
      },
      {
        icon: 'book-open-check',
        title: 'One history per container',
        body: 'The damage passport shows every damage a container has had, when it was first recorded and whether it was repaired.',
      },
      {
        icon: 'database',
        title: 'Your fleet data, your systems',
        body: 'Self-host Plomba or use Plomba Cloud, and pull sealed records into your fleet system over the API.',
      },
    ],
    screen: IMAGES.passport,
    screenCaption: 'One damage history per container, built from the sealed records only.',
    integration: {
      intro: 'Keep a condition view of the fleet in the system you already run.',
      steps: [
        "Pull each container's sealed history over the REST API.",
        'Receive `handover.sealed` webhooks for on-hire and off-hire handovers at the depots you work with.',
        'Attach the EIR and the evidence to a recharge.',
      ],
      example: {
        folder: 'examples/leasing-fleet-condition',
        description:
          'A fleet condition report by owner code, and the damage that appeared between on-hire and off-hire.',
      },
    },
  },
  {
    slug: 'terminals-and-depots',
    audience: 'Terminals and depots',
    shortName: 'Terminals and depots',
    icon: 'warehouse',
    summary:
      'The same walk-around for every checker, standard codes without a codebook, and a CODECO for every sealed handover.',
    metaTitle: 'Plomba for terminals and depots: standard inspections at the gate',
    metaDescription:
      'Give every checker the same fast walk-around, with CEDEX codes from where the mark sits, visible coverage, and a CODECO message for every sealed handover.',
    title: 'Standard inspections at the gate, without slowing it down',
    lead: 'Plomba gives every checker the same walk-around and standard codes without a codebook, and gives your customers a sealed record they can rely on.',
    pains: [
      {
        title: 'Gate throughput',
        body: 'Every minute spent writing up a container is a minute a truck or a train waits.',
      },
      {
        title: 'Codes from memory',
        body: 'CEDEX location, damage and component codes are hard to remember and easy to get wrong.',
      },
      {
        title: 'Gaps in coverage',
        body: 'A face gets skipped and nobody notices until there is a claim.',
      },
    ],
    gains: [
      {
        icon: 'crosshair',
        title: 'Codes from the position',
        body: 'The location code comes from where the mark sits on the container. Muse Spark proposes damage and component codes, and the checker confirms them.',
      },
      {
        icon: 'grid-3x3',
        title: 'Coverage you can see',
        body: "Each face and section lights up once a photo covers it. The checker sees what's missing before sealing, and any gap is recorded.",
      },
      {
        icon: 'file-code',
        title: 'CODECO from the gate',
        body: 'A gate-in or gate-out message in EDIFACT CODECO D.95B, in the SMDG profile, for every sealed handover.',
      },
      {
        icon: 'server',
        title: 'On your own machine',
        body: 'One Docker container with your data in one directory. Reading and damage detection can run on open weights on your own hardware.',
      },
    ],
    screen: IMAGES.handover,
    screenCaption:
      'A handover in progress: faces photographed, sections covered, damage to confirm.',
    integration: {
      intro: 'Plomba fits next to your terminal operating system rather than replacing it.',
      steps: [
        'Send CODECO gate messages to shipping lines and operators from every sealed handover.',
        'Receive `handover.sealed` webhooks in your TOS or yard system, and fetch records over the REST API.',
        'Hand drivers and customers the EIR as a PDF.',
      ],
    },
  },
];

export const solutionPath = (solution: Pick<Solution, 'slug'>): string =>
  `/solutions/${solution.slug}/`;
