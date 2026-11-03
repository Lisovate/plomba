import type { Page } from '../layout.ts';
import { cloud } from './cloud.ts';
import { home } from './home.ts';
import { integrations } from './integrations.ts';
import { openSource } from './open-source.ts';
import { privacy } from './privacy.ts';
import { solutionPages, solutionsIndex } from './solutions.ts';

/** Every published page, in the order the sitemap lists them. */
export const PAGES: readonly Page[] = [
  home,
  solutionsIndex,
  ...solutionPages,
  integrations,
  openSource,
  cloud,
  privacy,
];

export { notFound } from './responses.ts';
