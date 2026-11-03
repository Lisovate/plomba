/**
 * Opens a gate-in handover for every container on a train, from its wagon
 * list, and prints the checker's list.
 */

import { readFile } from 'node:fs/promises';
import { clientFromEnv, parseCommandLine, required, runCli, UsageError } from '../shared/cli.ts';
import { checkerList, openArrivals, parseWagonList, planTrain, WagonListError } from './train.ts';

const USAGE = `Usage: node examples/rail-operator-train-arrival/main.ts --wagons <list.csv> --place <terminal> --checker <name>
         [--train <number>] [--from <railway undertaking>] [--dry-run]

  --wagons    the wagon list: CSV with the columns wagon, container, size_type, seals
              (seals separated by semicolons)
  --place     the terminal the train arrives at
  --checker   who checks the train
  --train     the train's number, for the list's heading
  --from      who hands the containers over (the railway undertaking)
  --dry-run   check the list and print it, without opening handovers

Environment: PLOMBA_URL (default http://localhost:8787), PLOMBA_API_TOKEN

Exit code: 0 when every row has an open handover, 1 when any row was refused or failed.`;

runCli(USAGE, async () => {
  const { values } = parseCommandLine({
    options: {
      wagons: { type: 'string' },
      place: { type: 'string' },
      checker: { type: 'string' },
      train: { type: 'string' },
      from: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const file = required(values.wagons, 'wagons');
  const place = required(values.place, 'place');
  const checker = values['dry-run'] ? (values.checker ?? '') : required(values.checker, 'checker');

  let plan: ReturnType<typeof planTrain>;
  try {
    plan = planTrain(parseWagonList(await readFile(file, 'utf8')));
  } catch (error) {
    if (error instanceof WagonListError) throw new UsageError(`${file}: ${error.message}`);
    throw error;
  }

  const client = clientFromEnv();
  const arrivals = values['dry-run']
    ? undefined
    : await openArrivals(client, plan, {
        place,
        checker,
        ...(values.from ? { handedOverBy: values.from } : {}),
      });
  process.stdout.write(
    checkerList(plan, arrivals, {
      baseUrl: client.baseUrl,
      place,
      ...(values.train ? { train: values.train } : {}),
    }),
  );
  const failed = arrivals?.some((a) => a.status === 'failed') ?? false;
  return plan.rejected.length > 0 || failed ? 1 : 0;
});
