/** Builds the site into a temporary folder for a test file, and removes it afterwards. */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { buildSite } from '../src/build.ts';
import type { RenderContext } from '../src/layout.ts';
import { outputPaths } from '../src/output.ts';

export const TEST_ORIGIN = 'https://plomba.test';

export interface BuiltSite {
  readonly publicDir: string;
  readonly notFoundHtml: string;
  readonly render: RenderContext;
  /** Reads a file the build wrote, relative to the public folder. */
  readonly read: (path: string) => Promise<string>;
}

export function useBuiltSite(): () => BuiltSite {
  let distDir = '';
  let site: BuiltSite | undefined;

  beforeAll(async () => {
    distDir = await mkdtemp(join(tmpdir(), 'plomba-site-'));
    const { context } = await buildSite({ distDir, origin: TEST_ORIGIN });
    const out = outputPaths(distDir);
    site = {
      publicDir: out.publicDir,
      notFoundHtml: await readFile(out.notFoundPage, 'utf8'),
      render: context,
      read: (path) => readFile(join(out.publicDir, path), 'utf8'),
    };
  });

  afterAll(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  return () => {
    if (!site) throw new Error('The site is built in beforeAll');
    return site;
  };
}
