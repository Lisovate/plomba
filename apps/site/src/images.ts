/**
 * Every image the site shows, in one place: swap a screenshot here and every
 * page that shows it follows. Files live in public/images.
 *
 * The screens are cut out of docs/images/screens.jpg (scripts/make-images.ts).
 * The photos inside them are CC BY 3.0 frames, credited by PHOTO_CREDITS.
 */

export interface Image {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

export const IMAGES = {
  walkaround: {
    src: '/images/screen-walkaround.jpg',
    width: 559,
    height: 1211,
    alt: 'Plomba on a phone, playing sample footage of a rusty 40 ft container. SAM 3.1 tracks it; a tag follows it with its number, type, last sealed handover and verified records, and the rust recorded at Gdynia, LX30 CO, is drawn on the side.',
  },
  handover: {
    src: '/images/screen-handover.jpg',
    width: 559,
    height: 1211,
    alt: 'An open gate-out of container PLBU 400004 3 at Łódź inland terminal. On the left side, the rust recorded at the last handover, LX30 CO, is drawn on the same spot of the new photo.',
  },
  passport: {
    src: '/images/screen-passport.jpg',
    width: 559,
    height: 1211,
    alt: "A container's damage passport: a map of its faces with each damage coloured by the handover that first recorded it, and a dent that wasn't there at Gdańsk and was at Łódź: it happened between these two handovers.",
  },
  social: {
    src: '/images/social.jpg',
    width: 1200,
    height: 630,
    alt: 'The Plomba logo, a sealed container door, beside three screens of the app.',
  },
} as const satisfies Record<string, Image>;

export interface Credit {
  readonly title: string;
  readonly author: string;
  readonly url: string;
}

/** The footage in the app screens, licensed CC BY 3.0. */
export const PHOTO_CREDITS: readonly Credit[] = [
  {
    title: 'How to buy a shipping container in 10 minutes',
    author: 'Cowboy Steve Builds',
    url: 'https://www.youtube.com/watch?v=WFknzOt_8UA',
  },
  {
    title: "40' reefer shipping container delivery and repositioning",
    author: 'Life, Take 2',
    url: 'https://www.youtube.com/watch?v=CZkrwiKmvpY',
  },
];

export const PHOTO_LICENCE = {
  name: 'CC BY 3.0',
  url: 'https://creativecommons.org/licenses/by/3.0/',
} as const;
