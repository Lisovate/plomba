/**
 * What every example's command line shares: the Plomba client from the
 * environment, argument parsing that reports mistakes as usage errors, and
 * errors printed as plain messages (with the stack trace only when DEBUG is
 * set) and a non-zero exit code.
 *
 * Environment:
 * - PLOMBA_URL: the installation, e.g. https://plomba.example.com (default http://localhost:8787);
 * - PLOMBA_API_TOKEN: one of its API tokens (needed when it asks for an access code).
 */

import { type ParseArgsConfig, parseArgs } from 'node:util';
import {
  PlombaApiError,
  PlombaClient,
  PlombaContractError,
  PlombaUnreachableError,
} from './client.ts';

export const DEFAULT_URL = 'http://localhost:8787';

/** The command line was wrong; the usage is printed with the message. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): PlombaClient {
  return new PlombaClient({ baseUrl: env.PLOMBA_URL || DEFAULT_URL, token: env.PLOMBA_API_TOKEN });
}

/** `parseArgs` from node:util, with unknown or malformed options reported as usage errors. */
export function parseCommandLine<T extends ParseArgsConfig>(config: T) {
  try {
    return parseArgs(config);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** A required option, or a usage error naming it. */
export function required(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new UsageError(`--${option} is required`);
  return value.trim();
}

/**
 * Runs a command's main function. It resolves to the exit code (0 when it
 * returns nothing); errors are printed as one plain line with a hint.
 */
export function runCli(usage: string, main: () => Promise<number | undefined>): void {
  main().then(
    (code) => {
      process.exitCode = code ?? 0;
    },
    (error: unknown) => {
      process.exitCode = reportError(error, usage);
    },
  );
}

function reportError(error: unknown, usage: string): number {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${usage}`);
    return 2;
  }
  if (error instanceof PlombaApiError && error.status === 401) {
    console.error(
      `${error.message}\nSet PLOMBA_API_TOKEN to one of the installation's API tokens (PLOMBA_API_TOKENS_FILE on the server).`,
    );
    return 1;
  }
  if (error instanceof PlombaUnreachableError) {
    console.error(`${error.message}\nIs Plomba running? Set PLOMBA_URL to its address.`);
    return 1;
  }
  if (error instanceof PlombaApiError || error instanceof PlombaContractError) {
    console.error(error.message);
    return 1;
  }
  if (!(error instanceof Error)) console.error(String(error));
  else console.error(process.env.DEBUG ? (error.stack ?? error.message) : error.message);
  return 1;
}
