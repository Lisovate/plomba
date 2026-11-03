/** Facts about Plomba and Lisovate that pages link to or quote. */

export const SITE = {
  name: 'Plomba',
  /** Where the site is published; `SITE_URL` overrides it at build time. */
  origin: 'https://plomba.lisovate.com',
  company: 'Lisovate',
  author: 'Paweł Lisowski',
  place: 'Gdynia, Poland',
  email: 'hello@lisovate.com',
  repo: 'https://github.com/Lisovate/plomba',
  demo: 'https://app.plomba.lisovate.com',
  licence: 'Apache-2.0',
} as const;

export const mailto = (subject?: string): string =>
  subject ? `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}` : `mailto:${SITE.email}`;

/** A file in the repository on GitHub. */
export const repoFile = (path: string): string => `${SITE.repo}/blob/main/${path}`;

/** A folder in the repository on GitHub. */
export const repoFolder = (path: string): string => `${SITE.repo}/tree/main/${path}`;

export const WAITLIST_URL = '/cloud/#waitlist';

export const NAV = [
  { label: 'Solutions', href: '/solutions/' },
  { label: 'Integrations', href: '/integrations/' },
  { label: 'Open source', href: '/open-source/' },
  { label: 'Cloud and plans', href: '/cloud/' },
] as const;
