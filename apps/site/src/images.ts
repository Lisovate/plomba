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
    alt: 'Plomba on a phone, playing a walk-around video. SAM 3.1 tracks the container through 180 frames, and Muse Spark has named the doors and right side of this corner view, outlined on the video. Below are the frames chosen from the clip, each with the faces Muse Spark named.',
  },
  handover: {
    src: '/images/screen-handover.jpg',
    width: 559,
    height: 1211,
    alt: 'A gate-out handover of container PLBU 400004 3 at Łódź inland terminal. A photo of the left side on a truck shows the corrosion recorded at the last handover, LX50 CO, drawn on the same spot.',
  },
  passport: {
    src: '/images/screen-passport.jpg',
    width: 559,
    height: 1211,
    alt: "A container's damage passport: a map of its faces with each damage coloured by the handover that first recorded it, then the handovers and each damage's history.",
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
