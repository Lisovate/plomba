/**
 * Prints a driver's receipt for a truck's latest sealed handover, or writes
 * it as an HTML page to print or send.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clientFromEnv, parseCommandLine, required, runCli } from '../shared/cli.ts';
import { driverReceipt, receiptHtml, receiptText } from './receipt.ts';

const USAGE = `Usage: node examples/trucking-driver-receipt/main.ts --truck <registration> [--container <number>] [--html <file>]

  --truck       the truck's registration, e.g. "EL 4K217" (spaces, hyphens and case don't matter)
  --container   restrict the search to this container
  --html        write the receipt to this HTML file instead of printing it

Environment: PLOMBA_URL (default http://localhost:8787), PLOMBA_API_TOKEN`;

runCli(USAGE, async () => {
  const { values } = parseCommandLine({
    options: {
      truck: { type: 'string' },
      container: { type: 'string' },
      html: { type: 'string' },
    },
  });
  const truck = required(values.truck, 'truck');
  const receipt = await driverReceipt(clientFromEnv(), {
    truck,
    ...(values.container ? { container: values.container } : {}),
  });
  if (!receipt) {
    console.error(
      values.container
        ? `No sealed handover of ${values.container} with truck ${truck}.`
        : `No sealed handover with truck ${truck}.`,
    );
    return 1;
  }
  if (values.html) {
    const file = resolve(values.html);
    await writeFile(file, receiptHtml(receipt));
    console.log(`Wrote ${file}`);
  } else {
    process.stdout.write(receiptText(receipt));
  }
  return receipt.record.verified ? 0 : 1;
});
