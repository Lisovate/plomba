/**
 * Two reports for a container owner or lessor:
 * - `fleet`: the condition of every container with an owner code, as CSV and Markdown;
 * - `lease`: the damage a lessee is charged for, between on-hire and off-hire.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { clientFromEnv, parseCommandLine, required, runCli, UsageError } from '../shared/cli.ts';
import { FLEET_LIMIT, fleetCsv, fleetMarkdown, fleetReport } from './fleet.ts';
import { compareLease, LeaseError, leaseMarkdown } from './lease.ts';

const USAGE = `Usage:
  node examples/leasing-fleet-condition/main.ts fleet --owner <code> [--out <folder>]
  node examples/leasing-fleet-condition/main.ts lease --container <number> --on-hire <handover id> --off-hire <handover id> [--json]

  fleet   the condition of every container with the owner code (e.g. PLBU): writes
          fleet-<code>.csv and fleet-<code>.md to --out (default: the current folder)
  lease   the damage first recorded between the on-hire and off-hire handovers,
          with its evidence, as Markdown (or JSON with --json)

Environment: PLOMBA_URL (default http://localhost:8787), PLOMBA_API_TOKEN`;

runCli(USAGE, async () => {
  const { values, positionals } = parseCommandLine({
    options: {
      owner: { type: 'string' },
      out: { type: 'string', default: '.' },
      container: { type: 'string' },
      'on-hire': { type: 'string' },
      'off-hire': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const client = clientFromEnv();

  switch (positionals[0]) {
    case 'fleet': {
      const owner = required(values.owner, 'owner').toUpperCase();
      const report = await fleetReport(client, owner);
      const folder = resolve(values.out);
      await mkdir(folder, { recursive: true });
      const csv = join(folder, `fleet-${owner}.csv`);
      const markdown = join(folder, `fleet-${owner}.md`);
      await writeFile(csv, fleetCsv(report));
      await writeFile(markdown, fleetMarkdown(report));
      const damaged = report.containers.filter((c) => (c.damage?.open.length ?? 0) > 0).length;
      const broken = report.containers.filter((c) => c.chain === 'broken').length;
      console.log(
        `${report.containers.length} container(s) with owner code ${owner}: ${damaged} with open damage, ${broken} with a broken chain.`,
      );
      if (report.truncated) {
        console.log(`The API lists at most ${FLEET_LIMIT}; the fleet may be larger.`);
      }
      console.log(`Wrote ${csv}\nWrote ${markdown}`);
      return broken > 0 ? 1 : 0;
    }
    case 'lease': {
      const container = required(values.container, 'container');
      const history = await client.containerHistory(container);
      try {
        const comparison = compareLease(
          history,
          required(values['on-hire'], 'on-hire'),
          required(values['off-hire'], 'off-hire'),
        );
        process.stdout.write(
          values.json ? `${JSON.stringify(comparison, null, 2)}\n` : leaseMarkdown(comparison),
        );
        return 0;
      } catch (error) {
        if (error instanceof LeaseError) {
          console.error(error.message);
          return 1;
        }
        throw error;
      }
    }
    default:
      throw new UsageError(
        positionals[0] ? `Unknown command ${positionals[0]}` : 'Give a command: fleet or lease',
      );
  }
});
